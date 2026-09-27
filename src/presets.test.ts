import { describe, expect, it } from 'vitest';
import { sumBands, validateBands } from './bands';
import { DEFAULT_PRESET_NAME, PRESETS, presetBands } from './presets';

/** Copy of the previous design formula, kept here only as a regression reference. */
function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
function previousDesign(freq: number): number {
  const slope = 0.7;
  const shelfGain = 4.5;
  const tilt = slope * Math.log2(1000 / freq);
  const x = (Math.log2(freq) - Math.log2(40)) / (Math.log2(100) - Math.log2(40));
  const w = smoothstep(x);
  return shelfGain * (1 - w) + tilt * w;
}

/** The write grid: 1 Hz steps 20-200, 10 Hz steps 200-20000, ending at 20000. */
function writeGrid(): number[] {
  const grid: number[] = [];
  for (let f = 20; f < 200; f += 1) grid.push(f);
  for (let f = 200; f < 20000; f += 10) grid.push(f);
  grid.push(20000);
  return grid;
}

describe('presets', () => {
  it('ships Flat, the default preset and the two literature presets, in that order', () => {
    expect(PRESETS.map((p) => p.name)).toEqual([
      'Flat',
      'Default',
      'Harman (approximate)',
      'Toole (approximate)',
    ]);
    expect(DEFAULT_PRESET_NAME).toBe('Default');
  });

  it('Flat is 0 dB everywhere', () => {
    const bands = presetBands('Flat');
    expect(bands).toEqual([]);
    expect(sumBands(123, bands)).toBe(0);
  });

  it('every preset is valid and has a description', () => {
    for (const preset of PRESETS) {
      expect(validateBands(preset.bands)).toBeNull();
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it('the default preset stays within 0.1 dB of the previous formula on the whole write grid', () => {
    const bands = presetBands(DEFAULT_PRESET_NAME);
    let worst = 0;
    for (const f of writeGrid()) {
      worst = Math.max(worst, Math.abs(sumBands(f, bands) - previousDesign(f)));
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('the default preset is 4.50 dB at 20 Hz and 0 dB at 1 kHz', () => {
    const bands = presetBands(DEFAULT_PRESET_NAME);
    expect(sumBands(20, bands)).toBeCloseTo(4.5, 1);
    expect(Math.abs(sumBands(20, bands) - 4.5)).toBeLessThan(0.01);
    // the low shelf's tail leaves a few thousandths of a dB at 1 kHz
    expect(Math.abs(sumBands(1000, bands))).toBeLessThan(0.01);
  });

  it('presetBands returns a copy: editing it does not change the preset', () => {
    const first = presetBands(DEFAULT_PRESET_NAME);
    first[0].enabled = false;
    (first[1] as { gain: number }).gain = 99;
    const second = presetBands(DEFAULT_PRESET_NAME);
    expect(second[0].enabled).toBe(true);
    expect((second[1] as { gain: number }).gain).toBe(1.43);
  });

  it('throws for an unknown preset name', () => {
    expect(() => presetBands('nope')).toThrow(/nope/);
  });

  it('cites its source in both literature presets\' descriptions', () => {
    for (const name of ['Harman (approximate)', 'Toole (approximate)']) {
      const preset = PRESETS.find((p) => p.name === name)!;
      expect(preset.description).toMatch(/audiosciencereview\.com/);
      expect(preset.description).toMatch(/[Aa]pproximate/);
    }
  });

  it('the Harman preset reproduces its cited reference points within 0.5 dB', () => {
    const bands = presetBands('Harman (approximate)');
    // (frequency, dB) points read from the source CSV
    const reference: [number, number][] = [
      [20.56470821166976, 6.147211212700341],
      [47.75087106568793, 6.203439223819661],
      [110.79319926891314, 2.4802330821352605],
      [504.40908352705634, -0.6085083394865975],
      [989.5574833838288, -0.8972467749641666],
      [2499.3234023552486, -1.5659042044911615],
      [6312.483687438776, -2.276352723363594],
      [11383.219793966258, -2.65627171741302],
      [18869.070264997543, -2.967805292533555],
    ];
    for (const [freq, gain] of reference) {
      expect(Math.abs(sumBands(freq, bands) - gain)).toBeLessThan(0.5);
    }
  });

  it('the Toole preset reproduces its cited reference points within 0.5 dB', () => {
    const bands = presetBands('Toole (approximate)');
    const reference: [number, number][] = [
      [20.61619029268548, 3.6133707865168567],
      [62.51093152949732, 3.4048110316649662],
      [190.98012344351596, 2.4688049029622086],
      [764.1394393351363, 1.061654749744637],
      [1330.5965518353175, 0.5088457609805914],
      [4034.5392996626247, 0.16459652706843997],
      [7025.346165938076, -0.15829417773237964],
      [16142.782520148392, -0.3668539325842666],
      [19355.741537286776, -0.3530337078651655],
    ];
    for (const [freq, gain] of reference) {
      expect(Math.abs(sumBands(freq, bands) - gain)).toBeLessThan(0.5);
    }
  });
});

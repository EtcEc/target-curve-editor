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
  it('ships Flat and the default preset, in that order', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['Flat', 'Current (approximated)']);
    expect(DEFAULT_PRESET_NAME).toBe('Current (approximated)');
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
});

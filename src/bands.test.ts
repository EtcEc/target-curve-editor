import { describe, expect, it } from 'vitest';
import {
  BAND_TYPES,
  bandGain,
  defaultBand,
  sumBands,
  validateBands,
  type BellBand,
  type ShelfBand,
  type TiltBand,
} from './bands';

const tilt = (over: Partial<TiltBand> = {}): TiltBand => ({
  type: 'tilt',
  enabled: true,
  slope: 0.7,
  pivot: 1000,
  fLow: 20,
  fHigh: 20000,
  ...over,
});
const shelf = (type: ShelfBand['type'], over: Partial<ShelfBand> = {}): ShelfBand => ({
  type,
  enabled: true,
  gain: 6,
  freq: 100,
  q: 0.707,
  ...over,
});
const bell = (over: Partial<BellBand> = {}): BellBand => ({
  type: 'bell',
  enabled: true,
  gain: 4,
  freq: 1000,
  q: 1,
  ...over,
});

describe('tilt band', () => {
  it('is 0 dB at the pivot and follows slope dB/octave away from it', () => {
    expect(bandGain(1000, tilt({ slope: 3 }))).toBeCloseTo(0, 9);
    expect(bandGain(500, tilt({ slope: 3 }))).toBeCloseTo(3, 9);
    expect(bandGain(2000, tilt({ slope: 3 }))).toBeCloseTo(-3, 9);
  });

  it('uses the pivot it is given', () => {
    expect(bandGain(2000, tilt({ slope: 3, pivot: 2000 }))).toBeCloseTo(0, 9);
  });

  it('holds its value below fLow and above fHigh', () => {
    const t = tilt({ slope: 0.7, fLow: 50, fHigh: 8000 });
    expect(bandGain(20, t)).toBeCloseTo(bandGain(50, t), 12);
    expect(bandGain(30, t)).toBeCloseTo(0.7 * Math.log2(1000 / 50), 9);
    expect(bandGain(16000, t)).toBeCloseTo(bandGain(8000, t), 12);
    // inside the range it still follows the slope
    expect(bandGain(500, t)).toBeCloseTo(0.7, 9);
  });
});

describe('low shelf band', () => {
  it('reaches its full gain far below and 0 dB far above its frequency', () => {
    const s = shelf('lowShelf', { gain: 6, freq: 100 });
    expect(bandGain(1, s)).toBeCloseTo(6, 2);
    expect(bandGain(10000, s)).toBeCloseTo(0, 2);
  });

  it('is exactly half its gain (dB) at its own frequency, whatever the Q', () => {
    for (const q of [0.5, 0.707, 2]) {
      expect(bandGain(100, shelf('lowShelf', { gain: 6, freq: 100, q }))).toBeCloseTo(3, 6);
    }
  });

  it('supports cuts', () => {
    expect(bandGain(1, shelf('lowShelf', { gain: -4, freq: 100 }))).toBeCloseTo(-4, 2);
  });

  it('a higher Q makes the transition steeper (more overshoot near the corner)', () => {
    const soft = bandGain(150, shelf('lowShelf', { gain: 6, freq: 100, q: 0.5 }));
    const sharp = bandGain(150, shelf('lowShelf', { gain: 6, freq: 100, q: 2 }));
    expect(sharp).not.toBeCloseTo(soft, 1);
  });
});

describe('high shelf band', () => {
  it('mirrors the low shelf: 0 dB far below, full gain far above', () => {
    const s = shelf('highShelf', { gain: -5, freq: 8000 });
    expect(bandGain(10, s)).toBeCloseTo(0, 2);
    expect(bandGain(1000000, s)).toBeCloseTo(-5, 2);
    expect(bandGain(8000, s)).toBeCloseTo(-2.5, 6);
  });
});

describe('bell band', () => {
  it('has exactly its gain at the centre and returns to 0 dB far away', () => {
    const b = bell({ gain: 4, freq: 1000, q: 1 });
    expect(bandGain(1000, b)).toBeCloseTo(4, 6);
    expect(bandGain(10, b)).toBeCloseTo(0, 1);
    expect(bandGain(100000, b)).toBeCloseTo(0, 1);
  });

  it('is narrower with a higher Q', () => {
    const wide = bandGain(1500, bell({ q: 0.7 }));
    const narrow = bandGain(1500, bell({ q: 4 }));
    expect(Math.abs(narrow)).toBeLessThan(Math.abs(wide));
  });

  it('supports dips', () => {
    expect(bandGain(3000, bell({ gain: -6, freq: 3000 }))).toBeCloseTo(-6, 6);
  });
});

describe('disabled bands and sums', () => {
  it('a disabled band contributes 0', () => {
    expect(bandGain(500, tilt({ enabled: false }))).toBe(0);
    expect(bandGain(500, bell({ enabled: false }))).toBe(0);
  });

  it('sumBands adds the enabled bands', () => {
    const bands = [tilt({ slope: 3 }), bell({ gain: 4, freq: 500, q: 1 }), shelf('lowShelf', { enabled: false })];
    expect(sumBands(500, bands)).toBeCloseTo(3 + 4, 6);
  });

  it('an empty list is flat', () => {
    expect(sumBands(1234, [])).toBe(0);
  });
});

describe('validateBands', () => {
  it('accepts a valid list and an empty one', () => {
    expect(validateBands([tilt(), shelf('lowShelf'), bell()])).toBeNull();
    expect(validateBands([])).toBeNull();
  });

  it('refuses non-finite numbers, naming the band', () => {
    expect(validateBands([tilt(), bell({ gain: NaN })])).toMatch(/Band 2 \(Bell\)/);
    expect(validateBands([tilt({ slope: Infinity })])).toMatch(/Band 1 \(Tilt\)/);
  });

  it('refuses a tilt whose fLow is not below fHigh', () => {
    expect(validateBands([tilt({ fLow: 500, fHigh: 500 })])).toMatch(/hold below/);
    expect(validateBands([tilt({ fLow: 900, fHigh: 500 })])).not.toBeNull();
  });

  it('refuses non-positive frequencies and Q', () => {
    expect(validateBands([tilt({ pivot: 0 })])).not.toBeNull();
    expect(validateBands([shelf('lowShelf', { freq: 0 })])).not.toBeNull();
    expect(validateBands([bell({ q: 0 })])).toMatch(/Q/);
    expect(validateBands([bell({ freq: -5 })])).not.toBeNull();
  });

  it('refuses finite values that overflow into an unusable curve, naming the band', () => {
    expect(validateBands([tilt(), shelf('lowShelf', { gain: 13000 })])).toMatch(/Band 2 \(Low shelf\).*unusable curve/);
    expect(validateBands([bell({ freq: 1e-200 })])).toMatch(/Band 1 \(Bell\).*unusable curve/);
    expect(validateBands([bell(), bell({ q: 1e-200 })])).toMatch(/Band 2 \(Bell\).*unusable curve/);
  });

  it('still accepts extreme but sensible values', () => {
    expect(validateBands([shelf('lowShelf', { gain: 30 }), shelf('highShelf', { gain: -30 })])).toBeNull();
    expect(validateBands([bell({ gain: 30, q: 0.05 }), bell({ gain: -30, q: 20 })])).toBeNull();
  });
});

describe('defaultBand', () => {
  it('gives a valid, enabled band of each type', () => {
    for (const type of BAND_TYPES) {
      const band = defaultBand(type);
      expect(band.type).toBe(type);
      expect(band.enabled).toBe(true);
      expect(validateBands([band])).toBeNull();
    }
  });
});

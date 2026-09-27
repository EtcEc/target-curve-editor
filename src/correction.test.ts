import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CUTOFF_HZ,
  MAX_CUTOFF_HZ,
  MIN_CUTOFF_HZ,
  buildChannelTrims,
  summarizeCorrection,
  trimFromError,
  DEFAULT_TRIM_OPTIONS,
  DETAIL_STEPS,
  MAX_LIMIT_DB,
  MIN_LIMIT_DB,
  formatOctaves,
  type Correction,
} from './correction';
import { logGrid } from './measuredError';

const freq = logGrid();
/** 0 up to 1.5 kHz and `v` above: zero around the 1 kHz pin, so above the fade the trim is exactly -v. */
const shelf = (v: number) => freq.map((f) => (f >= 1500 ? v : 0));

describe('cutoff constants', () => {
  it('defaults to 500 Hz and allows 100-18000 Hz', () => {
    expect(DEFAULT_CUTOFF_HZ).toBe(500);
    expect(MIN_CUTOFF_HZ).toBe(100);
    expect(MAX_CUTOFF_HZ).toBe(18000);
  });
});

describe('trimFromError', () => {
  it('rejects a cutoff that is not a positive finite number', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => trimFromError(shelf(1), freq, bad)).toThrow(/cutoff/i);
    }
  });

  it('is zero below the fade, half at the cutoff and full above it', () => {
    const trim = trimFromError(shelf(2), freq, 4000);
    expect(trim(2000)).toBeCloseTo(0, 6);
    expect(trim(4000)).toBeCloseTo(-1, 1);
    expect(trim(5800)).toBeCloseTo(-2, 2);
    expect(trim(10000)).toBeCloseTo(-2, 6);
    expect(trim(20000)).toBeCloseTo(-2, 6);
  });

  it('is the negative of the error (a positive error gives a cut, a negative one a boost)', () => {
    expect(trimFromError(shelf(-2), freq, 4000)(10000)).toBeCloseTo(2, 6);
  });

  it('clamps to +/-3 dB', () => {
    expect(trimFromError(shelf(10), freq, 4000)(10000)).toBeCloseTo(-3, 6);
    expect(trimFromError(shelf(-10), freq, 4000)(10000)).toBeCloseTo(3, 6);
  });

  it('moves the fade with the cutoff', () => {
    const trim = trimFromError(shelf(2), freq, 8000);
    expect(trim(4000)).toBeCloseTo(0, 6);
    expect(trim(16000)).toBeCloseTo(-2, 6);
  });

  it('smooths a single-point spike instead of chasing it', () => {
    const error = freq.map(() => 0);
    error[freq.findIndex((f) => f >= 8000)] = 10;
    const trim = trimFromError(error, freq, 2000);
    for (const f of freq) expect(Math.abs(trim(f))).toBeLessThan(0.5);
  });

  it('interpolates between grid points and clamps beyond the ends', () => {
    const error = freq.map((f) => (f >= 5000 ? 2 : 0));
    const trim = trimFromError(error, freq, 1000);
    const between = trim(Math.sqrt(freq[100] * freq[101]));
    const lo = Math.min(trim(freq[100]), trim(freq[101]));
    const hi = Math.max(trim(freq[100]), trim(freq[101]));
    expect(between).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(between).toBeLessThanOrEqual(hi + 1e-9);
    expect(trim(50000)).toBeCloseTo(trim(20000), 9);
    expect(trim(5)).toBeCloseTo(trim(20), 9);
  });

  it('removes a pure level offset: a flat error gives no correction', () => {
    const trim = trimFromError(freq.map(() => 2.5), freq, 300);
    for (const f of freq) expect(Math.abs(trim(f))).toBeLessThan(1e-9);
  });

  it('lines the correction up at 1 kHz, not at the average level', () => {
    // 1 dB up to 1.5 kHz and 3 dB above: relative to 1 kHz the treble is 2 dB hot
    const error = freq.map((f) => (f >= 1500 ? 3 : 1));
    expect(trimFromError(error, freq, 4000)(10000)).toBeCloseTo(-2, 6);
  });

  it('pins the correction to 0 at 1 kHz for cutoffs below the octave around it', () => {
    const sloped = freq.map((f) => Math.log2(f / 200)); // about 2.3 dB at 1 kHz and changing through it
    for (const cutoff of [100, 300, 500, 700]) {
      expect(Math.abs(trimFromError(sloped, freq, cutoff)(1000))).toBeLessThan(0.01);
    }
  });
});

describe('buildChannelTrims / summarizeCorrection', () => {
  const correction: Correction = {
    FL: { positions: 3, error: shelf(2) },
    FR: { positions: 2, error: shelf(-1) },
  };

  it('builds one trim function per channel', () => {
    const trims = buildChannelTrims(correction, 4000);
    expect([...trims.keys()].sort()).toEqual(['FL', 'FR']);
    expect(trims.get('FL')!(10000)).toBeCloseTo(-2, 6);
    expect(trims.get('FR')!(10000)).toBeCloseTo(1, 6);
  });

  it('summarises positions and the largest trim per channel', () => {
    const fl = summarizeCorrection(correction, 4000).find((r) => r.commandId === 'FL')!;
    expect(fl.positions).toBe(3);
    expect(fl.maxAbsTrim).toBeCloseTo(2, 6);
  });

  it('reports a smaller largest trim for a higher cutoff', () => {
    const low = summarizeCorrection(correction, 4000)[0].maxAbsTrim;
    const none = summarizeCorrection(correction, 60000)[0].maxAbsTrim;
    expect(low).toBeGreaterThan(none);
  });
});

describe('trim options', () => {
  const at = (options: Partial<typeof DEFAULT_TRIM_OPTIONS>, error = shelf(2), cutoff = 4000) =>
    trimFromError(error, freq, cutoff, { ...DEFAULT_TRIM_OPTIONS, ...options });

  it('has the documented steps, defaults and limits', () => {
    expect(DETAIL_STEPS).toEqual([1 / 3, 1 / 2, 2 / 3, 1, 1.5, 2, 3]);
    expect(DEFAULT_TRIM_OPTIONS).toEqual({ detailOctaves: 1, strength: 1, limitDb: 3 });
    expect(MIN_LIMIT_DB).toBe(0.5);
    expect(MAX_LIMIT_DB).toBe(10);
  });

  it('behaves exactly as before with the default options', () => {
    const error = freq.map((f) => Math.sin(Math.log2(f)) * 2);
    const plain = trimFromError(error, freq, 500);
    const explicit = trimFromError(error, freq, 500, DEFAULT_TRIM_OPTIONS);
    for (const f of freq) expect(explicit(f)).toBe(plain(f));
  });

  it('scales the correction by strength', () => {
    expect(at({ strength: 0.5 })(10000)).toBeCloseTo(-1, 6);
    for (const f of freq) expect(at({ strength: 0 })(f)).toBeCloseTo(0, 12);
  });

  it('caps every cut and boost at the limit, after strength', () => {
    expect(at({ limitDb: 1 })(10000)).toBeCloseTo(-1, 6);
    expect(at({ strength: 0.5 }, shelf(10))(10000)).toBeCloseTo(-3, 6);
    expect(at({ strength: 0.5, limitDb: 6 }, shelf(10))(10000)).toBeCloseTo(-5, 6);
    expect(at({ limitDb: 6 }, shelf(-10))(10000)).toBeCloseTo(6, 6);
  });

  it('follows a narrow feature with fine detail and averages it away with coarse detail', () => {
    // a 3 dB step one third of an octave wide, centred on 8 kHz
    const narrow = freq.map((f) => (f >= 8000 / 2 ** (1 / 6) && f <= 8000 * 2 ** (1 / 6) ? 3 : 0));
    const fine = Math.abs(at({ detailOctaves: 1 / 3 }, narrow, 2000)(8000));
    const coarse = Math.abs(at({ detailOctaves: 3 }, narrow, 2000)(8000));
    expect(fine).toBeGreaterThan(2);
    expect(coarse).toBeLessThan(0.6);
  });

  it('keeps the 1 kHz pin for every detail width', () => {
    const sloped = freq.map((f) => Math.log2(f / 200));
    for (const detailOctaves of DETAIL_STEPS) {
      expect(Math.abs(at({ detailOctaves }, sloped, 300)(1000))).toBeLessThan(0.01);
    }
  });

  it('refuses settings outside their range', () => {
    expect(() => at({ detailOctaves: 0 })).toThrow(/Detail/);
    expect(() => at({ strength: -0.1 })).toThrow(/Strength/);
    expect(() => at({ strength: 1.1 })).toThrow(/Strength/);
    expect(() => at({ limitDb: 0 })).toThrow(/Limit/);
    expect(() => at({ limitDb: NaN })).toThrow(/Limit/);
  });

  it('passes the options through buildChannelTrims and summarizeCorrection', () => {
    const correction: Correction = { FL: { positions: 1, error: shelf(2) } };
    const options = { ...DEFAULT_TRIM_OPTIONS, limitDb: 1 };
    expect(buildChannelTrims(correction, 4000, options).get('FL')!(10000)).toBeCloseTo(-1, 6);
    expect(summarizeCorrection(correction, 4000, options)[0].maxAbsTrim).toBeCloseTo(1, 6);
  });

  it('formats detail widths as short fractions', () => {
    expect(DETAIL_STEPS.map(formatOctaves)).toEqual(['⅓', '½', '⅔', '1', '1½', '2', '3']);
  });
});

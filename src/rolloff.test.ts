import { describe, expect, it } from 'vitest';
import { ROLLOFF_TYPES, isRolloffType, rolloffGain } from './rolloff';

describe('isRolloffType', () => {
  it('accepts exactly 1 and 2', () => {
    expect(ROLLOFF_TYPES).toEqual([1, 2]);
    expect(isRolloffType(1)).toBe(true);
    expect(isRolloffType(2)).toBe(true);
    expect(isRolloffType(0)).toBe(false);
    expect(isRolloffType(3)).toBe(false);
    expect(isRolloffType(1.5)).toBe(false);
  });
});

describe('rolloffGain type 2 (High Frequency Roll Off 2)', () => {
  it('is 0 dB at the bottom and through the midrange', () => {
    expect(rolloffGain(2, 20)).toBeCloseTo(0, 6);
    expect(rolloffGain(2, 100)).toBeCloseTo(0, 4);
    expect(rolloffGain(2, 1000)).toBeCloseTo(0, 4);
  });

  it('matches the extracted table at known points', () => {
    expect(rolloffGain(2, 5000)).toBeCloseTo(-0.5772, 4);
    expect(rolloffGain(2, 10000)).toBeCloseTo(-3.4632, 3);
    expect(rolloffGain(2, 20000)).toBeCloseTo(-6.1328, 3);
  });
});

describe('rolloffGain type 1 (High Frequency Roll Off 1)', () => {
  it('is flat 0 dB below 2.5 kHz', () => {
    for (const f of [20, 100, 1000, 2000, 2500]) expect(rolloffGain(1, f)).toBe(0);
  });

  it('has the extracted shape at 10 kHz and 20 kHz', () => {
    expect(Math.abs(rolloffGain(1, 10000) - -1.87)).toBeLessThan(0.1);
    expect(Math.abs(rolloffGain(1, 20000) - -7.09)).toBeLessThan(0.15);
  });

  it('falls steadily to the very top with no kink or plateau (the last points come from a straight-line extrapolation)', () => {
    let previous = rolloffGain(1, 18000);
    for (let f = 18100; f <= 20000; f += 100) {
      const g = rolloffGain(1, f);
      expect(g).toBeLessThan(previous); // strictly falling
      expect(previous - g).toBeLessThan(0.12); // and no jump
      previous = g;
    }
  });

  it('is gentler than type 2 through the upper midrange and steeper right at the top', () => {
    expect(rolloffGain(1, 10000)).toBeGreaterThan(rolloffGain(2, 10000) + 1);
    expect(rolloffGain(1, 8000)).toBeGreaterThan(rolloffGain(2, 8000) + 0.8);
    expect(rolloffGain(1, 20000)).toBeLessThan(rolloffGain(2, 20000));
  });
});

describe('interpolation and clamping', () => {
  it('interpolates in log-frequency between table points', () => {
    const a = rolloffGain(1, 9000);
    const b = rolloffGain(1, 11000);
    const mid = rolloffGain(1, Math.sqrt(9000 * 11000));
    expect(mid).toBeCloseTo((a + b) / 2, 1);
  });

  it('clamps outside the table to its end values', () => {
    expect(rolloffGain(1, 1)).toBe(rolloffGain(1, 20));
    expect(rolloffGain(1, 1000000)).toBe(rolloffGain(1, 20000));
    expect(rolloffGain(2, 1000000)).toBe(rolloffGain(2, 20000));
  });
});

describe('rolloffGain type 2 (previous hfKnee tests)', () => {
  it('is exactly 0dB at the first extracted point (20Hz)', () => {
    expect(rolloffGain(2, 20)).toBeCloseTo(0, 6);
  });

  it('is 0dB well below the knee (100Hz)', () => {
    expect(rolloffGain(2, 100)).toBeCloseTo(0, 4);
  });

  it('is 0dB at 1kHz (flat midrange)', () => {
    expect(rolloffGain(2, 1000)).toBeCloseTo(0, 4);
  });

  it('is -0.5772dB at 5kHz', () => {
    expect(rolloffGain(2, 5000)).toBeCloseTo(-0.5772, 4);
  });

  it('is -3.4632dB at 10kHz', () => {
    expect(rolloffGain(2, 10000)).toBeCloseTo(-3.4632, 4);
  });

  it('is exactly -6.1328dB at the last extracted point (20kHz)', () => {
    expect(rolloffGain(2, 20000)).toBeCloseTo(-6.1328, 4);
  });

  it('clamps to the first extracted value below 20Hz', () => {
    expect(rolloffGain(2, 10)).toBeCloseTo(0, 6);
  });

  it('clamps to the last extracted value above 20kHz', () => {
    expect(rolloffGain(2, 30000)).toBeCloseTo(-6.1328, 4);
  });

  it('interpolates monotonically between two adjacent extracted points', () => {
    // sanity check: gain should move smoothly, not jump, between neighboring
    // points once inside the knee region
    const a = rolloffGain(2, 9990);
    const mid = rolloffGain(2, 9995);
    const b = rolloffGain(2, 10000);
    expect(mid).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-6);
    expect(mid).toBeLessThanOrEqual(Math.max(a, b) + 1e-6);
  });
});

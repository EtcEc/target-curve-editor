import { describe, it, expect } from 'vitest';
import { interpLogFreq } from './logInterp';

describe('interpLogFreq', () => {
  const xs = [100, 1000, 10000];
  const ys = [0, 10, 40];

  it('returns the exact value at a node', () => {
    expect(interpLogFreq(xs, ys, 1000)).toBeCloseTo(10, 9);
  });

  it('interpolates linearly in log-frequency between nodes', () => {
    expect(interpLogFreq(xs, ys, Math.sqrt(100 * 1000))).toBeCloseTo(5, 6);
    expect(interpLogFreq(xs, ys, Math.sqrt(1000 * 10000))).toBeCloseTo(25, 6);
  });

  it('clamps to the end values outside the range', () => {
    expect(interpLogFreq(xs, ys, 10)).toBe(0);
    expect(interpLogFreq(xs, ys, 50000)).toBe(40);
  });

  it('works with a single point', () => {
    expect(interpLogFreq([500], [7], 123)).toBe(7);
    expect(interpLogFreq([500], [7], 800)).toBe(7);
  });

  it('throws on empty data', () => {
    expect(() => interpLogFreq([], [], 100)).toThrow();
  });
});

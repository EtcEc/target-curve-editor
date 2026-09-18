import { describe, it, expect } from 'vitest';
import { chartFrequencies, designCurveData } from './chart';
import type { CurveParams } from './curve';

describe('chartFrequencies', () => {
  it('spans 20Hz to 20000Hz', () => {
    const freqs = chartFrequencies();
    expect(freqs[0]).toBeCloseTo(20, 6);
    expect(freqs[freqs.length - 1]).toBeCloseTo(20000, 1);
  });

  it('is log-spaced (equal ratios between consecutive points)', () => {
    const freqs = chartFrequencies();
    const ratio1 = freqs[1] / freqs[0];
    const ratio2 = freqs[freqs.length - 1] / freqs[freqs.length - 2];
    expect(ratio1).toBeCloseTo(ratio2, 3);
  });
});

describe('designCurveData', () => {
  it('returns matching-length frequency and gain arrays', () => {
    const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };
    const [freqs, gains] = designCurveData(params);
    expect(freqs.length).toBe(gains.length);
  });

  it('gain near 1kHz is close to 0 for a pure tilt', () => {
    const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };
    const [freqs, gains] = designCurveData(params);
    let nearestIdx = 0;
    let nearestDist = Infinity;
    freqs.forEach((f, i) => {
      const dist = Math.abs(f - 1000);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    });
    expect(gains[nearestIdx]).toBeCloseTo(0, 0);
  });
});

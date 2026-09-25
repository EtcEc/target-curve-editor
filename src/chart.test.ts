import { describe, it, expect } from 'vitest';
import { chartFrequencies, resultCurveData } from './chart';
import { rolloffGain } from './rolloff';
import { testParams, tiltBands } from './fixtures/testParams';

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

describe('resultCurveData', () => {
  it('returns matching-length frequency and gain arrays', () => {
    const [freqs, gains] = resultCurveData(testParams({ bands: tiltBands(3) }));
    expect(freqs.length).toBe(gains.length);
  });

  it('gain near 1kHz is close to 0 for a pure tilt', () => {
    const [freqs, gains] = resultCurveData(testParams({ bands: tiltBands(3) }));
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

  it('shows the design when the rolloff is cancelled and design + rolloff when it is not', () => {
    const cancelled = resultCurveData(testParams({ bands: tiltBands(0), cancelRolloff: true }));
    const shown = resultCurveData(testParams({ bands: tiltBands(0), cancelRolloff: false, rolloffType: 1 }));
    const last = cancelled[0].length - 1;
    expect(cancelled[1][last]).toBeCloseTo(0, 9);
    expect(shown[1][last]).toBeCloseTo(rolloffGain(1, shown[0][last]), 9);
  });
});

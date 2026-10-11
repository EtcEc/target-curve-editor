import { describe, expect, it } from 'vitest';
import { trimFromError, clampTotal, DEFAULT_TRIM_OPTIONS } from './correction';
import { previewCurves, subPreviewCurves } from './correctionPreview';
import { buildSubCorrections, subStep } from './subCorrection';
import { effectiveTarget, logGrid } from './measuredError';
import { createSampleAdy } from './fixtures/sampleAdy';

const grid = logGrid();
const channel = () => {
  const c = createSampleAdy().detectedChannels[0];
  c.customTargetCurvePoints = grid.map((f) => `{${f.toFixed(3)}, ${(-0.7 * Math.log2(f / 1000)).toFixed(3)}}`);
  return c;
};
const error = grid.map((f) => (f >= 1500 ? 2 : 0));
const soFar = grid.map(() => 0);

describe('previewCurves', () => {
  it('shows the target, the measurement, the measured-with curve and the new curve on the log grid', () => {
    const curves = previewCurves(channel(), 2, { positions: 1, error, soFar }, 500);
    const target = effectiveTarget(channel(), 2);
    const trim = trimFromError(error, grid, 500);
    expect(curves.freq).toEqual(grid);
    curves.target.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.measured.forEach((v, i) => expect(v).toBeCloseTo(target[i] + error[i], 9));
    curves.measuredWith.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(target[i] + trim(grid[i]), 9));
  });

  it('leaves the target alone below the fade', () => {
    const curves = previewCurves(channel(), 2, { positions: 1, error, soFar }, 4000);
    const i = grid.findIndex((f) => f >= 1000);
    expect(curves.corrected[i]).toBeCloseTo(curves.target[i], 9);
  });

  it('uses the trim options for the new curve', () => {
    const options = { ...DEFAULT_TRIM_OPTIONS, strength: 0.5, limitDb: 0.5 };
    const curves = previewCurves(channel(), 2, { positions: 1, error, soFar }, 500, options);
    const trim = trimFromError(error, grid, 500, options);
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(curves.target[i] + trim(grid[i]), 9));
  });

  it('builds on the correction so far and caps the total at the limit', () => {
    const before = grid.map(() => -2.5);
    const curves = previewCurves(channel(), 2, { positions: 1, error, soFar: before }, 500);
    const i = grid.findIndex((f) => f >= 8000);
    expect(curves.measuredWith[i]).toBeCloseTo(curves.target[i] - 2.5, 9);
    // -2.5 so far plus a -2 step, capped at -3
    expect(curves.corrected[i]).toBeCloseTo(curves.target[i] - 3, 9);
  });
});

describe('subPreviewCurves', () => {
  it('shows the sub\'s target, the common error, the measured-with curve and the new sub curve', () => {
    const ady = createSampleAdy();
    ady.enTargetCurveType = 2;
    ady.detectedChannels[0].customTargetCurvePoints = channel().customTargetCurvePoints;
    ady.detectedChannels[1].customTargetCurvePoints = channel().customTargetCurvePoints;
    const bass = grid.map((f) => (f < 60 ? 2 : 0));
    const [sub] = buildSubCorrections(ady, ady, { FL: { positions: 1, error: bass, soFar } });
    const subChannel = ady.detectedChannels[1];
    const curves = subPreviewCurves(subChannel, 2, sub, 0);
    const target = effectiveTarget(subChannel, 2);
    const step = subStep(sub, 0);
    curves.target.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.measured.forEach((v, i) => expect(v).toBeCloseTo(target[i] + bass[i], 9));
    curves.measuredWith.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(target[i] + clampTotal(0, step(grid[i]), 3), 9));
  });
});

import { describe, expect, it } from 'vitest';
import { trimFromError, DEFAULT_TRIM_OPTIONS } from './correction';
import { previewCurves } from './correctionPreview';
import { effectiveTarget, logGrid } from './measuredError';
import { createSampleAdy } from './fixtures/sampleAdy';

const grid = logGrid();
const channel = () => {
  const c = createSampleAdy().detectedChannels[0];
  c.customTargetCurvePoints = grid.map((f) => `{${f.toFixed(3)}, ${(-0.7 * Math.log2(f / 1000)).toFixed(3)}}`);
  return c;
};
const error = grid.map((f) => (f >= 1500 ? 2 : 0));

describe('previewCurves', () => {
  it('shows the current target, the measurement and the corrected target on the log grid', () => {
    const curves = previewCurves(channel(), 2, { positions: 1, error }, 500);
    const target = effectiveTarget(channel(), 2);
    const trim = trimFromError(error, grid, 500);
    expect(curves.freq).toEqual(grid);
    curves.current.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.measured.forEach((v, i) => expect(v).toBeCloseTo(target[i] + error[i], 9));
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(target[i] + trim(grid[i]), 9));
  });

  it('leaves the target alone below the fade', () => {
    const curves = previewCurves(channel(), 2, { positions: 1, error }, 4000);
    const i = grid.findIndex((f) => f >= 1000);
    expect(curves.corrected[i]).toBeCloseTo(curves.current[i], 9);
  });

  it('uses the trim options for the corrected line', () => {
    const options = { ...DEFAULT_TRIM_OPTIONS, strength: 0.5, limitDb: 0.5 };
    const curves = previewCurves(channel(), 2, { positions: 1, error }, 500, options);
    const trim = trimFromError(error, grid, 500, options);
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(curves.current[i] + trim(grid[i]), 9));
  });
});

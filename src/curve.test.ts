import { describe, expect, it } from 'vitest';
import { computeTrimShift, designGain, frequencyGrid, resultGain, writtenGain } from './curve';
import { rolloffGain } from './rolloff';
import { testParams, tiltBands } from './fixtures/testParams';

describe('frequencyGrid', () => {
  it('starts at 20Hz and ends at exactly 20000Hz', () => {
    const grid = frequencyGrid();
    expect(grid[0]).toBe(20);
    expect(grid[grid.length - 1]).toBe(20000);
  });

  it('uses 1Hz steps below 200Hz and 10Hz steps above', () => {
    const grid = frequencyGrid();
    expect(grid[1] - grid[0]).toBe(1);
    const idx200 = grid.indexOf(200);
    expect(grid[idx200 + 1] - grid[idx200]).toBe(10);
  });

  it('has 2161 points', () => {
    expect(frequencyGrid()).toHaveLength(2161);
  });
});

describe('designGain', () => {
  it('is the sum of the bands', () => {
    const params = testParams({ bands: tiltBands(3) });
    expect(designGain(500, params)).toBeCloseTo(3 * Math.log2(1000 / 500), 9);
  });

  it('is flat with no bands', () => {
    expect(designGain(777, testParams({ bands: [] }))).toBe(0);
  });
});

describe('writtenGain and resultGain', () => {
  const bands = tiltBands(3);

  it('cancels the selected rolloff in the written curve by default', () => {
    const params = testParams({ bands, rolloffType: 2 });
    expect(writtenGain(10000, params)).toBeCloseTo(designGain(10000, params) - rolloffGain(2, 10000), 9);
  });

  it('cancels Roll Off 1 when that type is selected', () => {
    const params = testParams({ bands, rolloffType: 1 });
    expect(writtenGain(10000, params)).toBeCloseTo(designGain(10000, params) - rolloffGain(1, 10000), 9);
  });

  it('writes the raw design when cancel is off', () => {
    const params = testParams({ bands, cancelRolloff: false });
    expect(writtenGain(10000, params)).toBeCloseTo(designGain(10000, params), 9);
  });

  it('the listener gets the design when the rolloff is cancelled', () => {
    const params = testParams({ bands });
    for (const f of [100, 5000, 10000, 20000]) {
      expect(resultGain(f, params)).toBeCloseTo(designGain(f, params), 9);
    }
  });

  it('the listener gets design + rolloff when cancel is off', () => {
    const params = testParams({ bands, cancelRolloff: false, rolloffType: 1 });
    expect(resultGain(10000, params)).toBeCloseTo(designGain(10000, params) + rolloffGain(1, 10000), 9);
  });
});

describe('computeTrimShift', () => {
  it('is the maximum of the written curve over the write grid', () => {
    const params = testParams({ bands: tiltBands(0.7) });
    const max = Math.max(...frequencyGrid().map((f) => writtenGain(f, params)));
    expect(computeTrimShift(params)).toBeCloseTo(max, 9);
  });

  it('follows the selected rolloff type', () => {
    // a rising curve at 20kHz makes the rolloff type matter for the maximum
    const high = [{ type: 'tilt' as const, enabled: true, slope: -3, pivot: 1000, fLow: 20, fHigh: 20000 }];
    const one = computeTrimShift(testParams({ bands: high, rolloffType: 1 }));
    const two = computeTrimShift(testParams({ bands: high, rolloffType: 2 }));
    expect(one).not.toBeCloseTo(two, 3);
  });
});

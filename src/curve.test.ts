import { describe, it, expect } from 'vitest';
import { tilt, frequencyGrid, designGain, writtenGain, computeTrimShift, type CurveParams } from './curve';
import { hfKneeGain } from './hfKnee';

describe('tilt', () => {
  it('is 0dB at the 1kHz pivot regardless of slope', () => {
    expect(tilt(1000, 6)).toBeCloseTo(0, 6);
    expect(tilt(1000, -3)).toBeCloseTo(0, 6);
  });

  it('boosts below the pivot for positive slope', () => {
    expect(tilt(500, 6)).toBeCloseTo(6, 6);
  });

  it('cuts above the pivot for positive slope', () => {
    expect(tilt(2000, 6)).toBeCloseTo(-6, 6);
  });
});

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
});

describe('designGain', () => {
  it('equals tilt exactly when the shelf is disabled', () => {
    const params: CurveParams = { slope: 4, shelfEnabled: false, shelfGain: 0 };
    expect(designGain(300, params)).toBeCloseTo(tilt(300, 4), 9);
  });

  it('is close to 0dB at the pivot, barely nudged by a shelf far below it', () => {
    // slope=6, shelfGain=6 -> tilt(f)=shelfGain at f=500Hz, well below the 1kHz pivot
    const params: CurveParams = { slope: 6, shelfEnabled: true, shelfGain: 6 };
    expect(designGain(1000, params)).toBeCloseTo(-0.0272, 3);
  });

  it('sits slightly below shelfGain right at the tilt/shelf crossing frequency', () => {
    // tilt(500, 6) === 6 === shelfGain, so this is exactly the crossing point
    const params: CurveParams = { slope: 6, shelfEnabled: true, shelfGain: 6 };
    expect(designGain(500, params)).toBeCloseTo(4.9603, 3);
  });

  it('asymptotically approaches shelfGain well below the crossing frequency', () => {
    const params: CurveParams = { slope: 6, shelfEnabled: true, shelfGain: 6 };
    expect(designGain(100, params)).toBeCloseTo(6.0, 2);
  });

  it('does not produce NaN when slope is 0 and the shelf is enabled', () => {
    const params: CurveParams = { slope: 0, shelfEnabled: true, shelfGain: 6 };
    for (const freq of [20, 100, 500, 1000, 5000, 20000]) {
      const result = designGain(freq, params);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeCloseTo(Math.min(tilt(freq, 0), params.shelfGain), 9);
    }
  });

  it('degrades to Math.min(tilt, shelfGain) at slope 0 even with a negative shelfGain', () => {
    const params: CurveParams = { slope: 0, shelfEnabled: true, shelfGain: -3 };
    for (const freq of [20, 1000, 20000]) {
      const result = designGain(freq, params);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeCloseTo(Math.min(tilt(freq, 0), params.shelfGain), 9);
    }
  });
});

describe('writtenGain', () => {
  it('equals designGain minus the HF knee at a point where the knee is non-zero', () => {
    const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };
    const expected = designGain(10000, params) - hfKneeGain(10000);
    expect(writtenGain(10000, params)).toBeCloseTo(expected, 9);
  });

  it('is unaffected by the HF knee well below the knee (100Hz)', () => {
    const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };
    expect(writtenGain(100, params)).toBeCloseTo(designGain(100, params), 3);
  });
});

describe('computeTrimShift', () => {
  it('is the writtenGain value at 20Hz for a positive-slope, shelf-disabled curve', () => {
    // the curve is monotonically decreasing with frequency in this case, so the
    // max over the grid is at its lowest point, 20Hz
    const params: CurveParams = { slope: 6, shelfEnabled: false, shelfGain: 0 };
    const expected = writtenGain(20, params);
    expect(computeTrimShift(params)).toBeCloseTo(expected, 6);
  });

  it('is close to shelfGain when the shelf is enabled and caps the bass boost', () => {
    const params: CurveParams = { slope: 6, shelfEnabled: true, shelfGain: 6 };
    expect(computeTrimShift(params)).toBeCloseTo(6, 2);
  });

  it('equals the negative of the HF knee minimum when slope is 0 (flat design, pure knee cancellation)', () => {
    const params: CurveParams = { slope: 0, shelfEnabled: false, shelfGain: 0 };
    expect(computeTrimShift(params)).toBeCloseTo(5.9444, 3);
  });
});

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

  it('equals shelfGain exactly at and below 40Hz', () => {
    const params: CurveParams = { slope: 0.7, shelfEnabled: true, shelfGain: 6 };
    expect(designGain(40, params)).toBeCloseTo(6, 9);
    expect(designGain(20, params)).toBeCloseTo(6, 9);
  });

  it('equals tilt exactly at and above 100Hz (shelf has no influence there)', () => {
    const params: CurveParams = { slope: 0.7, shelfEnabled: true, shelfGain: 6 };
    expect(designGain(100, params)).toBeCloseTo(tilt(100, 0.7), 9);
    expect(designGain(200, params)).toBeCloseTo(tilt(200, 0.7), 9);
  });

  it('actually boosts the low end for a gentle slope (the reported bug)', () => {
    // at slope=0.7 the tilt alone only reaches ~3.95dB by 20Hz -- nowhere
    // near a 6dB shelf. The crossfade must still deliver the full 6dB
    // at/below 40Hz regardless of how gentle the slope is.
    const params: CurveParams = { slope: 0.7, shelfEnabled: true, shelfGain: 6 };
    expect(tilt(20, 0.7)).toBeLessThan(4);
    expect(designGain(20, params)).toBeCloseTo(6, 9);
  });

  it('blends exactly halfway at the log-frequency midpoint between 40Hz and 100Hz', () => {
    // smoothstep(0.5) === 0.5, so the geometric mean of the two breakpoints
    // is where the blend is a plain 50/50 average of shelfGain and tilt(f)
    const params: CurveParams = { slope: 3, shelfEnabled: true, shelfGain: 6 };
    const midFreq = Math.sqrt(40 * 100);
    const expected = (params.shelfGain + tilt(midFreq, params.slope)) / 2;
    expect(designGain(midFreq, params)).toBeCloseTo(expected, 6);
  });

  it('matches the reference shape exactly at slope=0: flat shelfGain below 40Hz, flat 0dB above 100Hz', () => {
    const params: CurveParams = { slope: 0, shelfEnabled: true, shelfGain: 6 };
    expect(designGain(20, params)).toBeCloseTo(6, 9);
    expect(designGain(100, params)).toBeCloseTo(0, 9);
    expect(designGain(20000, params)).toBeCloseTo(0, 9);
  });

  it('never produces NaN, including at slope=0', () => {
    const params: CurveParams = { slope: 0, shelfEnabled: true, shelfGain: 6 };
    for (const freq of [20, 40, 63, 100, 1000, 20000]) {
      expect(Number.isFinite(designGain(freq, params))).toBe(true);
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

  it('is close to shelfGain for a gentle slope where the shelf plateau is the peak of the curve', () => {
    const params: CurveParams = { slope: 0.7, shelfEnabled: true, shelfGain: 6 };
    expect(computeTrimShift(params)).toBeCloseTo(6, 2);
  });

  it('equals the negative of the HF knee minimum when slope is 0 (flat design, pure knee cancellation)', () => {
    const params: CurveParams = { slope: 0, shelfEnabled: false, shelfGain: 0 };
    expect(computeTrimShift(params)).toBeCloseTo(6.1328, 3);
  });
});

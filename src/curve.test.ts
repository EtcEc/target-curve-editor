import { describe, it, expect } from 'vitest';
import { tilt, frequencyGrid, designGain, type CurveParams } from './curve';

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
});

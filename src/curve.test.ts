import { describe, it, expect } from 'vitest';
import { tilt, frequencyGrid } from './curve';

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

import { describe, it, expect } from 'vitest';
import { averagePositions, logGrid, normalizeLevel, rmsOver, smoothToGrid } from './measuredError';
import { synthMeasurement } from './fixtures/synthMeasurement';

const powerMean = (a: number, b: number) => 10 * Math.log10((10 ** (a / 10) + 10 ** (b / 10)) / 2);

describe('logGrid', () => {
  it('has 241 points from exactly 20 Hz to exactly 20 kHz', () => {
    const grid = logGrid();
    expect(grid).toHaveLength(241);
    expect(grid[0]).toBe(20);
    expect(grid[grid.length - 1]).toBe(20000);
  });

  it('is ascending with 24 points per octave', () => {
    const grid = logGrid();
    for (let i = 1; i < grid.length; i++) expect(grid[i]).toBeGreaterThan(grid[i - 1]);
    expect(grid[24] / grid[0]).toBeCloseTo(2, 9);
    expect(grid[1] / grid[0]).toBeCloseTo(2 ** (1 / 24), 9);
  });

  it('returns a fresh array each call', () => {
    const a = logGrid();
    a[0] = 999;
    expect(logGrid()[0]).toBe(20);
  });
});

describe('smoothToGrid', () => {
  it('leaves a flat measurement flat', () => {
    const out = smoothToGrid(synthMeasurement(() => 70));
    expect(out).toHaveLength(241);
    for (const v of out) expect(v).toBeCloseTo(70, 6);
  });

  it('power-averages alternating values inside each window', () => {
    // even points 60 dB, odd points 66 dB: power mean is about 63.96 dB
    let i = 0;
    const out = smoothToGrid(synthMeasurement(() => (i++ % 2 === 0 ? 60 : 66)));
    const grid = logGrid();
    const at1k = out[grid.findIndex((f) => f >= 1000)];
    expect(Math.abs(at1k - powerMean(60, 66))).toBeLessThan(0.1);
  });

  it('interpolates where the raw data is too sparse to fill a window', () => {
    const out = smoothToGrid({ freq: [10, 1000, 20000], spl: [60, 70, 65] });
    // grid[0] is 20 Hz, whose window contains no raw points
    expect(out[0]).toBeCloseTo(60 + (10 * (Math.log10(20) - 1)) / 2, 6);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('averagePositions', () => {
  it('power-averages dB curves', () => {
    const out = averagePositions([
      [60, 60],
      [66, 66],
    ]);
    expect(out[0]).toBeCloseTo(powerMean(60, 66), 9);
    expect(out[1]).toBeCloseTo(powerMean(60, 66), 9);
  });

  it('returns a single curve unchanged', () => {
    const out = averagePositions([[55, 61, 70]]);
    expect(out[0]).toBeCloseTo(55, 9);
    expect(out[2]).toBeCloseTo(70, 9);
  });

  it('throws when given no curves', () => {
    expect(() => averagePositions([])).toThrow();
  });
});

describe('normalizeLevel', () => {
  it('brings a flat curve to zero', () => {
    for (const v of normalizeLevel(logGrid().map(() => 73))) expect(v).toBeCloseTo(0, 9);
  });

  it('preserves shape and zeroes the 500-1500 Hz mean', () => {
    const grid = logGrid();
    const curve = grid.map((_, i) => 73 + i * 0.01);
    const out = normalizeLevel(curve);
    expect(out[10] - out[0]).toBeCloseTo(0.1, 9);
    const band = out.filter((_, i) => grid[i] >= 500 && grid[i] <= 1500);
    expect(band.reduce((a, b) => a + b, 0) / band.length).toBeCloseTo(0, 9);
  });
});

describe('rmsOver', () => {
  it('is the RMS of the values inside the range only', () => {
    const grid = logGrid();
    const curve = grid.map((f) => (f >= 2000 ? 2 : 100));
    expect(rmsOver(curve, 2000, 20000)).toBeCloseTo(2, 9);
  });

  it('returns 0 when no grid point falls in the range', () => {
    expect(rmsOver(logGrid().map(() => 5), 30000, 40000)).toBe(0);
  });
});

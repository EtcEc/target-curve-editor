import { describe, it, expect } from 'vitest';
import type { AdyChannel } from './ady';
import { rolloffGain } from './rolloff';
import {
  TargetParseError,
  averagePositions,
  computeError,
  effectiveTarget,
  logGrid,
  normalizeLevel,
  rmsOver,
  smoothToGrid,
} from './measuredError';
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

function channelWith(points: string[]): AdyChannel {
  return { commandId: 'FL', customTargetCurvePoints: points, trimAdjustment: '0.000000' };
}

/** Points in the same "{freq, gain}" format the app writes into .ady files. */
function pointsFor(fn: (f: number) => number): string[] {
  return logGrid().map((f) => `{${f.toFixed(3)}, ${fn(f).toFixed(3)}}`);
}

describe('effectiveTarget', () => {
  it('is the knee alone for a channel with no custom points (stock calibration)', () => {
    const grid = logGrid();
    const target = effectiveTarget(channelWith([]), 2);
    expect(target[grid.length - 1]).toBeCloseTo(rolloffGain(2, 20000), 3);
    expect(target[grid.findIndex((f) => f >= 1000)]).toBeCloseTo(0, 2);
  });

  it('ignores a constant offset in the written points', () => {
    const stock = effectiveTarget(channelWith([]), 2);
    const offset = effectiveTarget(channelWith(pointsFor(() => 4.5)), 2);
    offset.forEach((v, i) => expect(v).toBeCloseTo(stock[i], 6));
  });

  it('adds the knee on top of the written curve', () => {
    const tilt = (f: number) => -0.7 * Math.log2(f / 1000);
    const grid = logGrid();
    const target = effectiveTarget(channelWith(pointsFor(tilt)), 2);
    // level normalisation shifts everything by a constant, so compare differences
    const i = grid.findIndex((f) => f >= 10000);
    const j = grid.findIndex((f) => f >= 1000);
    const raw = (f: number) => tilt(f) + rolloffGain(2, f);
    expect(target[i] - target[j]).toBeCloseTo(raw(grid[i]) - raw(grid[j]), 2);
  });

  it('throws TargetParseError for a point it cannot read', () => {
    expect(() => effectiveTarget(channelWith(['{20.0 4.5}']), 2)).toThrow(TargetParseError);
    expect(() => effectiveTarget(channelWith(['{20.0 4.5}']), 2)).toThrow(/FL/);
  });

  it('uses the shape of the given rolloff type', () => {
    const grid = logGrid();
    const one = effectiveTarget(channelWith([]), 1);
    const two = effectiveTarget(channelWith([]), 2);
    const i = grid.findIndex((f) => f >= 10000);
    // both are ~0 dB across 500-1500 Hz, so level normalisation shifts them equally
    expect(one[i] - two[i]).toBeCloseTo(rolloffGain(1, grid[i]) - rolloffGain(2, grid[i]), 3);
    expect(one[i]).toBeGreaterThan(two[i] + 1);
  });
});

describe('computeError', () => {
  const tilt = (f: number) => -0.7 * Math.log2(f / 1000);
  const bump = (f: number) => 1.5 * Math.exp(-(Math.log2(f / 8000) ** 2) / (2 * 0.3 ** 2));
  const channel = () => channelWith(pointsFor(tilt));
  // a chain that delivers exactly written + knee, plus a planted error bump at 8 kHz
  const measuredFn = (f: number) => 70 + tilt(f) + rolloffGain(2, f) + bump(f);

  it('recovers a planted error shape', () => {
    const grid = logGrid();
    const error = computeError([synthMeasurement(measuredFn)], channel(), 2);
    expect(error).toHaveLength(241);
    expect(error[grid.findIndex((f) => f >= 8000)]).toBeCloseTo(1.5, 1);
    expect(error[grid.findIndex((f) => f >= 1000)]).toBeCloseTo(0, 1);
    expect(error[grid.findIndex((f) => f >= 100)]).toBeCloseTo(0, 1);
  });

  it('is near zero everywhere for a chain that hits the target exactly', () => {
    // 0.3 dB rather than tighter: the smoothing window at the 20 kHz edge is one-sided
    const error = computeError([synthMeasurement((f) => 70 + tilt(f) + rolloffGain(2, f))], channel(), 2);
    for (const v of error) expect(Math.abs(v)).toBeLessThan(0.3);
  });

  it('averages files that use different frequency grids', () => {
    const smooth = (f: number) => 70 + 3 * Math.sin(Math.log2(f));
    const single = computeError([synthMeasurement(smooth, 3000)], channelWith([]), 2);
    const mixed = computeError([synthMeasurement(smooth, 3000), synthMeasurement(smooth, 1500)], channelWith([]), 2);
    single.forEach((v, i) => expect(Math.abs(v - mixed[i])).toBeLessThan(0.05));
  });

  it('throws when given no measurements', () => {
    expect(() => computeError([], channel(), 2)).toThrow();
  });
});

import type { AdyChannel } from './ady';
import { rolloffGain, type RolloffType } from './rolloff';
import { interpLogFreq } from './logInterp';
import type { RewMeasurement } from './rewParse';
import { readCurvePoints } from './curvePoints';

const START_HZ = 20;
const END_HZ = 20000;
const STEPS_PER_OCTAVE = 24;
const SMOOTHING_OCTAVES = 1 / 6;
/** Measurements and targets are lined up at 1 kHz: over the octave centred on it. */
export const ANCHOR_HZ = 1000;
const NORMALIZE_LO_HZ = ANCHOR_HZ / Math.SQRT2;
const NORMALIZE_HI_HZ = ANCHOR_HZ * Math.SQRT2;

/**
 * The shared log grid: 20 * 2^(i/24) for i = 0..239, plus a final point at
 * exactly 20 kHz (241 points). A fresh array every call.
 */
export function logGrid(): number[] {
  const grid: number[] = [];
  const steps = Math.floor(STEPS_PER_OCTAVE * Math.log2(END_HZ / START_HZ));
  for (let i = 0; i <= steps; i++) grid.push(START_HZ * 2 ** (i / STEPS_PER_OCTAVE));
  if (grid[grid.length - 1] !== END_HZ) grid.push(END_HZ);
  return grid;
}

/** Index of the first element of the ascending `xs` that is >= `x`. */
function lowerBound(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Resamples a measurement onto the log grid: at each grid point, the power
 * average of the raw points within +/- 1/12 octave (1/6-octave window). Where
 * the raw data is too sparse to put any point in a window, interpolates in
 * log-frequency instead. Returns dB.
 */
export function smoothToGrid(m: RewMeasurement): number[] {
  const power = m.spl.map((s) => 10 ** (s / 10));
  const half = 2 ** (SMOOTHING_OCTAVES / 2);
  return logGrid().map((fc) => {
    const a = lowerBound(m.freq, fc / half);
    const b = lowerBound(m.freq, fc * half);
    if (b > a) {
      let sum = 0;
      for (let i = a; i < b; i++) sum += power[i];
      return 10 * Math.log10(sum / (b - a));
    }
    return interpLogFreq(m.freq, m.spl, fc);
  });
}

/** Power average of dB curves that are already on the grid (what REW's RMS average does). */
export function averagePositions(curves: readonly number[][]): number[] {
  if (curves.length === 0) throw new Error('averagePositions: no curves');
  return curves[0].map((_, i) => {
    let sum = 0;
    for (const c of curves) sum += 10 ** (c[i] / 10);
    return 10 * Math.log10(sum / curves.length);
  });
}

/** Subtracts the mean level over the octave around 1 kHz so only shape is left. */
export function normalizeLevel(curve: readonly number[]): number[] {
  const grid = logGrid();
  let sum = 0;
  let count = 0;
  grid.forEach((f, i) => {
    if (f >= NORMALIZE_LO_HZ && f <= NORMALIZE_HI_HZ) {
      sum += curve[i];
      count++;
    }
  });
  const mean = sum / count;
  return curve.map((v) => v - mean);
}

/** RMS of the grid-aligned `curve` values with loHz <= f <= hiHz (0 if none). */
export function rmsOver(curve: readonly number[], loHz: number, hiHz: number): number {
  const grid = logGrid();
  let sum = 0;
  let count = 0;
  grid.forEach((f, i) => {
    if (f >= loHz && f <= hiHz) {
      sum += curve[i] ** 2;
      count++;
    }
  });
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/** The channel's written curve (dB) on the grid; all zeros when it has no custom points. */
function writtenCurve(channel: AdyChannel): number[] {
  const grid = logGrid();
  const { freqs, gains } = readCurvePoints(channel);
  if (freqs.length === 0) return grid.map(() => 0);
  return grid.map((f) => interpLogFreq(freqs, gains, f));
}

/**
 * What Audyssey is actually aiming for on this channel: the written curve plus
 * the HF rolloff it always applies on top (the rolloff alone for a stock
 * calibration), level-normalised so only shape matters.
 */
export function effectiveTarget(channel: AdyChannel, rolloffType: RolloffType): number[] {
  const grid = logGrid();
  const written = writtenCurve(channel);
  return normalizeLevel(grid.map((f, i) => written[i] + rolloffGain(rolloffType, f)));
}

/**
 * E(f) = measured - target, on the grid: the measurements are smoothed,
 * power-averaged across positions and level-normalised, then the channel's
 * effective target is subtracted.
 */
export function computeError(
  measurements: readonly RewMeasurement[],
  channel: AdyChannel,
  rolloffType: RolloffType
): number[] {
  if (measurements.length === 0) throw new Error('computeError: no measurements');
  const measured = normalizeLevel(averagePositions(measurements.map(smoothToGrid)));
  const target = effectiveTarget(channel, rolloffType);
  return measured.map((v, i) => v - target[i]);
}

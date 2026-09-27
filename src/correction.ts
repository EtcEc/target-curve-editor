import { smoothstep, type TrimFn } from './curve';
import { interpLogFreq } from './logInterp';
import { ANCHOR_HZ, logGrid } from './measuredError';

/** One speaker's measured error on the shared log grid (`logGrid()`). */
export interface ChannelCorrection {
  /** How many measurement positions were averaged into `error`. */
  positions: number;
  /** measured - target (dB) at each grid point, lined up at 1 kHz. */
  error: number[];
}

/** Measured errors per channel (commandId). Kept in memory only. */
export type Correction = Record<string, ChannelCorrection>;

export const DEFAULT_CUTOFF_HZ = 500;
export const MIN_CUTOFF_HZ = 100;
export const MAX_CUTOFF_HZ = 18000;

/** Grid points either side of centre for the 1-octave box smoothing (24 points per octave). */
const SMOOTH_HALF_WIDTH_POINTS = 12;
const TRIM_CLAMP_DB = 3;
/** The trim fades in over this many octaves, centred on the cutoff. */
const FADE_WIDTH_OCTAVES = 1;

/**
 * Turns a measured error curve into a trim: 1-octave smoothing, re-pin so the
 * smoothed error is 0 at 1 kHz (each curve keeps its value there), clamp to
 * +/-3 dB, fade in around the cutoff, negate. The returned function looks the
 * trim up by log-frequency interpolation between `freq` points.
 */
export function trimFromError(error: readonly number[], freq: readonly number[], cutoffHz: number): TrimFn {
  if (!Number.isFinite(cutoffHz) || cutoffHz <= 0) {
    throw new Error(`Cutoff must be a positive finite frequency, got ${cutoffHz}`);
  }
  const n = error.length;
  const smoothed = error.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - SMOOTH_HALF_WIDTH_POINTS; j <= i + SMOOTH_HALF_WIDTH_POINTS; j++) {
      sum += error[Math.min(n - 1, Math.max(0, j))];
      count++;
    }
    return sum / count;
  });
  const pin = interpLogFreq(freq, smoothed, ANCHOR_HZ);
  const trims = smoothed.map((value, i) => {
    const clamped = Math.max(-TRIM_CLAMP_DB, Math.min(TRIM_CLAMP_DB, value - pin));
    const weight = smoothstep(Math.log2(freq[i] / cutoffHz) / FADE_WIDTH_OCTAVES + 0.5);
    return -weight * clamped;
  });
  return (f: number) => interpLogFreq(freq, trims, f);
}

/** One trim function per channel in the correction, for the given cutoff. */
export function buildChannelTrims(correction: Correction, cutoffHz: number): Map<string, TrimFn> {
  const freq = logGrid();
  const trims = new Map<string, TrimFn>();
  for (const [id, channel] of Object.entries(correction)) {
    trims.set(id, trimFromError(channel.error, freq, cutoffHz));
  }
  return trims;
}

export interface TrimSummaryRow {
  commandId: string;
  positions: number;
  maxAbsTrim: number;
}

export function summarizeCorrection(correction: Correction, cutoffHz: number): TrimSummaryRow[] {
  const freq = logGrid();
  return Object.entries(correction).map(([commandId, channel]) => {
    const trim = trimFromError(channel.error, freq, cutoffHz);
    let maxAbsTrim = 0;
    for (const f of freq) maxAbsTrim = Math.max(maxAbsTrim, Math.abs(trim(f)));
    return { commandId, positions: channel.positions, maxAbsTrim };
  });
}

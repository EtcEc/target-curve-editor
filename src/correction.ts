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

/** The shared log grid has 24 points per octave. */
const GRID_POINTS_PER_OCTAVE = 24;
/** The trim fades in over this many octaves, centred on the cutoff. */
const FADE_WIDTH_OCTAVES = 1;

/** How the measured error becomes a trim. */
export interface TrimOptions {
  /** Width (octaves) the error is averaged over: small follows narrow features, large only broad trends. */
  detailOctaves: number;
  /** Fraction of the error that is corrected, 0-1. */
  strength: number;
  /** Largest cut or boost, in dB. */
  limitDb: number;
}

/** The detail widths offered on the Correct page. */
export const DETAIL_STEPS: readonly number[] = [1 / 3, 1 / 2, 2 / 3, 1, 1.5, 2, 3];
export const DEFAULT_TRIM_OPTIONS: Readonly<TrimOptions> = { detailOctaves: 1, strength: 1, limitDb: 3 };
export const MIN_LIMIT_DB = 0.5;
export const MAX_LIMIT_DB = 10;

const OCTAVE_LABELS: ReadonlyMap<number, string> = new Map([
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [1.5, '1½'],
]);

/** A detail width as a short label, e.g. 0.5 -> "½", 1.5 -> "1½", 2 -> "2". */
export function formatOctaves(octaves: number): string {
  return OCTAVE_LABELS.get(octaves) ?? String(octaves);
}

/**
 * Turns a measured error curve into a trim: average over the detail width,
 * re-pin so the averaged error is 0 at 1 kHz (each curve keeps its value
 * there), scale by strength, clamp to +/- the limit, fade in around the cutoff,
 * negate. The returned function looks the trim up by log-frequency
 * interpolation between `freq` points.
 */
export function trimFromError(
  error: readonly number[],
  freq: readonly number[],
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): TrimFn {
  if (!Number.isFinite(cutoffHz) || cutoffHz <= 0) {
    throw new Error(`Cutoff must be a positive finite frequency, got ${cutoffHz}`);
  }
  const { detailOctaves, strength, limitDb } = options;
  if (!(Number.isFinite(detailOctaves) && detailOctaves > 0)) {
    throw new Error(`Detail must be a positive number of octaves, got ${detailOctaves}`);
  }
  if (!(strength >= 0 && strength <= 1)) {
    throw new Error(`Strength must be between 0 and 1, got ${strength}`);
  }
  if (!(Number.isFinite(limitDb) && limitDb > 0)) {
    throw new Error(`Limit must be a positive number of dB, got ${limitDb}`);
  }
  const halfWidth = Math.round((GRID_POINTS_PER_OCTAVE * detailOctaves) / 2);
  const n = error.length;
  const smoothed = error.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - halfWidth; j <= i + halfWidth; j++) {
      sum += error[Math.min(n - 1, Math.max(0, j))];
      count++;
    }
    return sum / count;
  });
  const pin = interpLogFreq(freq, smoothed, ANCHOR_HZ);
  const trims = smoothed.map((value, i) => {
    const clamped = Math.max(-limitDb, Math.min(limitDb, strength * (value - pin)));
    const weight = smoothstep(Math.log2(freq[i] / cutoffHz) / FADE_WIDTH_OCTAVES + 0.5);
    return -weight * clamped;
  });
  return (f: number) => interpLogFreq(freq, trims, f);
}

/** One trim function per channel in the correction, for the given cutoff and options. */
export function buildChannelTrims(
  correction: Correction,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): Map<string, TrimFn> {
  const freq = logGrid();
  const trims = new Map<string, TrimFn>();
  for (const [id, channel] of Object.entries(correction)) {
    trims.set(id, trimFromError(channel.error, freq, cutoffHz, options));
  }
  return trims;
}

export interface TrimSummaryRow {
  commandId: string;
  positions: number;
  maxAbsTrim: number;
}

export function summarizeCorrection(
  correction: Correction,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): TrimSummaryRow[] {
  const freq = logGrid();
  return Object.entries(correction).map(([commandId, channel]) => {
    const trim = trimFromError(channel.error, freq, cutoffHz, options);
    let maxAbsTrim = 0;
    for (const f of freq) maxAbsTrim = Math.max(maxAbsTrim, Math.abs(trim(f)));
    return { commandId, positions: channel.positions, maxAbsTrim };
  });
}

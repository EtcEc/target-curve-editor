import { smoothstep, type TrimFn } from './curve';
import { interpLogFreq } from './logInterp';
import { logGrid } from './measuredError';

export interface CorrectionChannel {
  /** How many measurement positions were averaged into `error`. */
  positions: number;
  /** measured - target (dB) at each entry of the file's `freq`. */
  error: number[];
}

export interface CorrectionFile {
  version: 1;
  created: string;
  label: string;
  freq: number[];
  channels: Record<string, CorrectionChannel>;
}

export class CorrectionValidationError extends Error {}

export function createCorrection(
  channels: Record<string, CorrectionChannel>,
  label: string,
  now: Date = new Date()
): CorrectionFile {
  return { version: 1, created: now.toISOString(), label, freq: logGrid(), channels };
}

export function serializeCorrection(correction: CorrectionFile): string {
  return JSON.stringify(correction);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Parses and validates a correction file. Throws CorrectionValidationError with the reason. */
export function parseCorrection(text: string): CorrectionFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new CorrectionValidationError(`Not valid JSON: ${(err as Error).message}`);
  }
  if (!isObject(raw)) throw new CorrectionValidationError('Top level of the file is not an object');
  if (raw.version !== 1) {
    throw new CorrectionValidationError(`Unsupported correction file version: ${String(raw.version)}`);
  }
  if (typeof raw.created !== 'string') throw new CorrectionValidationError('Missing "created" timestamp');
  const label = typeof raw.label === 'string' ? raw.label : '';

  const freq = raw.freq;
  if (!Array.isArray(freq) || freq.length < 2 || !freq.every(isFiniteNumber)) {
    throw new CorrectionValidationError('"freq" must be an array of at least two finite numbers');
  }
  if (freq[0] <= 0) throw new CorrectionValidationError('"freq" must be positive');
  for (let i = 1; i < freq.length; i++) {
    if (freq[i] <= freq[i - 1]) throw new CorrectionValidationError('"freq" must be strictly ascending');
  }

  if (!isObject(raw.channels)) throw new CorrectionValidationError('"channels" must be an object');
  const channels: Record<string, CorrectionChannel> = {};
  for (const [id, value] of Object.entries(raw.channels)) {
    if (!isObject(value)) throw new CorrectionValidationError(`Channel ${id} is not an object`);
    const positions = value.positions;
    if (typeof positions !== 'number' || !Number.isInteger(positions) || positions < 1) {
      throw new CorrectionValidationError(`Channel ${id}: "positions" must be a positive integer`);
    }
    const error = value.error;
    if (!Array.isArray(error) || error.length !== freq.length || !error.every(isFiniteNumber)) {
      throw new CorrectionValidationError(`Channel ${id}: "error" must be ${freq.length} finite numbers`);
    }
    channels[id] = { positions, error };
  }

  return { version: 1, created: raw.created, label, freq, channels };
}

export const DEFAULT_CUTOFF_HZ = 2000;

/** Grid points either side of centre for the 1-octave box smoothing (24 points per octave). */
const SMOOTH_HALF_WIDTH_POINTS = 12;
const TRIM_CLAMP_DB = 3;
/** The trim fades in over this many octaves, centred on the cutoff. */
const FADE_WIDTH_OCTAVES = 1;

/**
 * Turns a measured error curve into a trim: 1-octave smoothing, clamp to
 * +/-3 dB, fade in around the cutoff, negate. The returned function looks the
 * trim up by log-frequency interpolation between `freq` points.
 */
export function trimFromError(error: readonly number[], freq: readonly number[], cutoffHz: number): TrimFn {
  const n = error.length;
  const trims = error.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - SMOOTH_HALF_WIDTH_POINTS; j <= i + SMOOTH_HALF_WIDTH_POINTS; j++) {
      sum += error[Math.min(n - 1, Math.max(0, j))];
      count++;
    }
    const clamped = Math.max(-TRIM_CLAMP_DB, Math.min(TRIM_CLAMP_DB, sum / count));
    const weight = smoothstep(Math.log2(freq[i] / cutoffHz) / FADE_WIDTH_OCTAVES + 0.5);
    return -weight * clamped;
  });
  return (f: number) => interpLogFreq(freq, trims, f);
}

/** One trim function per channel in the correction, for the given cutoff. */
export function buildChannelTrims(correction: CorrectionFile, cutoffHz: number): Map<string, TrimFn> {
  const trims = new Map<string, TrimFn>();
  for (const [id, channel] of Object.entries(correction.channels)) {
    trims.set(id, trimFromError(channel.error, correction.freq, cutoffHz));
  }
  return trims;
}

export interface TrimSummaryRow {
  commandId: string;
  positions: number;
  maxAbsTrim: number;
  /** False when a base .ady is loaded and lacks this channel (the entry is ignored). */
  inBase: boolean;
}

export function summarizeCorrection(
  correction: CorrectionFile,
  cutoffHz: number,
  baseChannelIds: readonly string[]
): TrimSummaryRow[] {
  return Object.entries(correction.channels).map(([commandId, channel]) => {
    const trim = trimFromError(channel.error, correction.freq, cutoffHz);
    let maxAbsTrim = 0;
    for (const f of correction.freq) maxAbsTrim = Math.max(maxAbsTrim, Math.abs(trim(f)));
    return {
      commandId,
      positions: channel.positions,
      maxAbsTrim,
      inBase: baseChannelIds.length === 0 || baseChannelIds.includes(commandId),
    };
  });
}

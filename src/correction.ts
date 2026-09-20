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

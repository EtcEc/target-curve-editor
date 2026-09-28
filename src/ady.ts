import { frequencyGrid, writtenGain, computeTrimShift, type CurveParams, type TrimFn } from './curve';
import { readCurvePoints } from './curvePoints';
import { interpLogFreq } from './logInterp';

export interface AdyChannel {
  commandId: string;
  customTargetCurvePoints: string[];
  trimAdjustment: string;
  [key: string]: unknown;
}

export interface AdyFile {
  enTargetCurveType: number;
  detectedChannels: AdyChannel[];
  [key: string]: unknown;
}

export class AdyValidationError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateChannel(channel: unknown, index: number): asserts channel is AdyChannel {
  if (!isPlainObject(channel)) {
    throw new AdyValidationError(`detectedChannels[${index}] is not an object`);
  }
  if (typeof channel.commandId !== 'string') {
    throw new AdyValidationError(`detectedChannels[${index}].commandId is missing or not a string`);
  }
  // Some MultEQ-X files leave the key out on channels that never had a custom curve.
  if (!('customTargetCurvePoints' in channel)) {
    channel.customTargetCurvePoints = [];
  }
  if (!Array.isArray(channel.customTargetCurvePoints)) {
    throw new AdyValidationError(`detectedChannels[${index}].customTargetCurvePoints is not an array`);
  }
  if (typeof channel.trimAdjustment !== 'string') {
    throw new AdyValidationError(`detectedChannels[${index}].trimAdjustment is missing or not a string`);
  }
}

/** Parses and validates a .ady file's JSON text. Throws AdyValidationError on any structural mismatch. */
export function parseAdy(jsonText: string): AdyFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new AdyValidationError(`Not valid JSON: ${(err as Error).message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new AdyValidationError('Top level of the file is not an object');
  }
  if (typeof parsed.enTargetCurveType !== 'number') {
    throw new AdyValidationError('Missing or non-numeric enTargetCurveType');
  }
  if (!Array.isArray(parsed.detectedChannels) || parsed.detectedChannels.length === 0) {
    throw new AdyValidationError('Missing or empty detectedChannels array');
  }
  parsed.detectedChannels.forEach((channel, i) => validateChannel(channel, i));

  return parsed as AdyFile;
}

/** A channel is treated as a subwoofer if its commandId starts with "SW" (e.g. SW1, SW2). */
export function isSubwooferChannel(channel: AdyChannel): boolean {
  return channel.commandId.startsWith('SW');
}

function formatPoint(freq: number, gain: number): string {
  const text = gain.toFixed(3);
  // a value that rounds to zero from below would print "-0.000"; write it as "0.000"
  return `{${freq.toFixed(1)}, ${text === '-0.000' ? '0.000' : text}}`;
}

/**
 * Returns a new AdyFile with the designed curve written to every channel and
 * enTargetCurveType set to the selected HF rolloff type. When params.subTrim
 * is on, subwoofer trim is compensated; when off, the sub's trimAdjustment is
 * left exactly as it was. Does not mutate the input.
 */
export function applyCurveToAdy(ady: AdyFile, params: CurveParams): AdyFile {
  const clone = JSON.parse(JSON.stringify(ady)) as AdyFile;
  const sharedPoints = frequencyGrid().map((f) => formatPoint(f, writtenGain(f, params)));
  const trimShift = computeTrimShift(params);

  for (const channel of clone.detectedChannels) {
    channel.customTargetCurvePoints = sharedPoints;
    if (isSubwooferChannel(channel) && params.subTrim) {
      const originalTrim = parseFloat(channel.trimAdjustment);
      channel.trimAdjustment = (originalTrim + trimShift).toFixed(6);
    }
  }

  clone.enTargetCurveType = params.rolloffType;
  return clone;
}

export class MeasuredCorrectionError extends Error {}

/**
 * Returns a new AdyFile with a measured correction added to the curves already
 * in the file. Each non-sub channel that has a trim gets its existing curve,
 * resampled onto the write grid (log-frequency interpolation), plus the trim.
 * Everything else — other channels' points, every trimAdjustment,
 * enTargetCurveType, all other fields — is copied as is. Does not mutate the
 * input. Throws MeasuredCorrectionError for a trimmed channel with no curve.
 */
export function applyMeasuredCorrection(ady: AdyFile, trims: ReadonlyMap<string, TrimFn>): AdyFile {
  const clone = JSON.parse(JSON.stringify(ady)) as AdyFile;
  const grid = frequencyGrid();
  for (const channel of clone.detectedChannels) {
    if (isSubwooferChannel(channel)) continue;
    const trim = trims.get(channel.commandId);
    if (!trim) continue;
    const { freqs, gains } = readCurvePoints(channel);
    if (freqs.length === 0) {
      throw new MeasuredCorrectionError(
        `Channel ${channel.commandId} has no target curve. Design one on the Design page first.`
      );
    }
    channel.customTargetCurvePoints = grid.map((f) => formatPoint(f, interpLogFreq(freqs, gains, f) + trim(f)));
  }
  return clone;
}

const POINT_FREQUENCY = /^\{\s*([0-9.]+)\s*,/;

/**
 * True when some channel's customTargetCurvePoints sit exactly on this tool's
 * write grid (2161 points, 1 Hz then 10 Hz steps). Such a file was very likely
 * written by this tool (or the script it replaced), so the sub trim was
 * probably already applied to it. A heuristic: files from other sources may
 * not match.
 */
export function looksAlreadyProcessed(ady: AdyFile): boolean {
  const grid = frequencyGrid();
  return ady.detectedChannels.some((channel) => {
    const points = channel.customTargetCurvePoints;
    if (points.length !== grid.length) return false;
    return points.every((point, i) => {
      const match = POINT_FREQUENCY.exec(point);
      return match !== null && Math.abs(parseFloat(match[1]) - grid[i]) < 0.06;
    });
  });
}

export function serializeAdy(ady: AdyFile): string {
  return JSON.stringify(ady);
}

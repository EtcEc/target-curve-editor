import { isSubwooferChannel, type AdyChannel, type AdyFile } from './ady';
import { TargetParseError } from './curvePoints';
import {
  DEFAULT_TRIM_OPTIONS,
  changeExtent,
  trimFromError,
  type Correction,
  type TrimOptions,
  type TrimSummaryRow,
} from './correction';
import { smoothstep, type TrimFn } from './curve';
import { logGrid, writtenCurve } from './measuredError';

/** Used when no corrected speaker has a usable customCrossover (the AVR's usual setting). */
export const DEFAULT_CROSSOVER_HZ = 80;

/**
 * A sub's share of the measured correction: the error every measured speaker
 * has in common (their bass is the sub playing), applied below about twice the
 * crossover.
 */
export interface SubCorrection {
  commandId: string;
  /** How many speakers the common error averages. */
  fromSpeakers: number;
  /** The crossover the sub's band is set from. */
  crossoverHz: number;
  /** The common error c (dB) on the log grid: the mean of the speakers' errors. */
  error: number[];
  /** The sub's curve in the measured-with file minus its target curve (dB) on the log grid. */
  soFar: number[];
}

/** The highest numeric customCrossover among the given speakers in `target`, or 80 Hz. */
export function crossoverHz(target: AdyFile, speakerIds: readonly string[]): number {
  const values = speakerIds
    .map((id) => Number(target.detectedChannels.find((c) => c.commandId === id)?.customCrossover))
    .filter((v) => Number.isFinite(v) && v > 0);
  return values.length > 0 ? Math.max(...values) : DEFAULT_CROSSOVER_HZ;
}

/** 1 below 2X/√2, 0.5 at 2X, 0 above 2X·√2: the sub barely plays above that. */
export function subBandWeight(f: number, crossover: number): number {
  return 1 - smoothstep(Math.log2(f / (2 * crossover)) + 0.5);
}

/** The dB mean of the speakers' errors at each grid point. */
export function commonError(correction: Correction): number[] {
  const errors = Object.values(correction).map((c) => c.error);
  return errors[0].map((_, i) => errors.reduce((sum, e) => sum + e[i], 0) / errors.length);
}

/** Both channels' written curves on the log grid, or null when either can't be read (the sub is then left alone). */
function readableCurves(target: AdyChannel, measuredWith: AdyChannel): [number[], number[]] | null {
  try {
    return [writtenCurve(target), writtenCurve(measuredWith)];
  } catch (err) {
    if (err instanceof TargetParseError) return null;
    throw err;
  }
}

/**
 * One SubCorrection per sub channel with a readable curve in both files, all sharing
 * the speakers' common error. Empty when no speaker was measured.
 */
export function buildSubCorrections(
  target: AdyFile,
  measuredWith: AdyFile,
  correction: Correction
): SubCorrection[] {
  const speakers = Object.keys(correction);
  if (speakers.length === 0) return [];
  const error = commonError(correction);
  const crossover = crossoverHz(target, speakers);
  const subs: SubCorrection[] = [];
  for (const channel of target.detectedChannels) {
    if (!isSubwooferChannel(channel) || channel.customTargetCurvePoints.length === 0) continue;
    const withChannel = measuredWith.detectedChannels.find((c) => c.commandId === channel.commandId);
    if (!withChannel || withChannel.customTargetCurvePoints.length === 0) continue;
    const curves = readableCurves(channel, withChannel);
    if (!curves) continue;
    const [targetCurve, withCurve] = curves;
    subs.push({
      commandId: channel.commandId,
      fromSpeakers: speakers.length,
      crossoverHz: crossover,
      error,
      soFar: withCurve.map((v, i) => v - targetCurve[i]),
    });
  }
  return subs;
}

/** This round's step for a sub: the common error's trim, faded out above the sub's band. */
export function subStep(sub: SubCorrection, cutoffHz: number, options: TrimOptions = DEFAULT_TRIM_OPTIONS): TrimFn {
  const trim = trimFromError(sub.error, logGrid(), cutoffHz, options);
  return (f) => trim(f) * subBandWeight(f, sub.crossoverHz);
}

/** Table rows for the subs; `positions` holds how many speakers each is based on. */
export function summarizeSubs(
  subs: readonly SubCorrection[],
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): TrimSummaryRow[] {
  const freq = logGrid();
  return subs.map((sub) => ({
    commandId: sub.commandId,
    positions: sub.fromSpeakers,
    ...changeExtent(sub.soFar, subStep(sub, cutoffHz, options), freq, options.limitDb),
  }));
}

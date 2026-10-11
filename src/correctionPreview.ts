import type { AdyChannel } from './ady';
import {
  clampTotal,
  trimFromError,
  type ChannelCorrection,
  type TrimOptions,
  DEFAULT_TRIM_OPTIONS,
} from './correction';
import { effectiveTarget, logGrid } from './measuredError';
import type { RolloffType } from './rolloff';
import type { TrimFn } from './curve';
import { subStep, type SubCorrection } from './subCorrection';

export interface PreviewCurves {
  freq: number[];
  /** What you are aiming for: the target file's curve plus the HF rolloff. */
  target: number[];
  /** The measured response. */
  measured: number[];
  /** What the AVR was aiming for during the measurement: the target plus the correction so far. */
  measuredWith: number[];
  /** The curve the download writes: the target plus the capped total correction. */
  corrected: number[];
}

function curvesFor(
  channel: AdyChannel,
  rolloffType: RolloffType,
  error: readonly number[],
  soFar: readonly number[],
  step: TrimFn,
  limitDb: number
): PreviewCurves {
  const freq = logGrid();
  const target = effectiveTarget(channel, rolloffType);
  return {
    freq,
    target,
    measured: target.map((v, i) => v + error[i]),
    measuredWith: target.map((v, i) => v + soFar[i]),
    corrected: target.map((v, i) => v + clampTotal(soFar[i], step(freq[i]), limitDb)),
  };
}

/** The Correct page chart's lines for one speaker (`channel` is the target file's), all lined up at 1 kHz. */
export function previewCurves(
  channel: AdyChannel,
  rolloffType: RolloffType,
  correction: ChannelCorrection,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): PreviewCurves {
  const step = trimFromError(correction.error, logGrid(), cutoffHz, options);
  return curvesFor(channel, rolloffType, correction.error, correction.soFar, step, options.limitDb);
}

/** The same lines for a sub: "measured" is its target plus the speakers' common error. */
export function subPreviewCurves(
  channel: AdyChannel,
  rolloffType: RolloffType,
  sub: SubCorrection,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): PreviewCurves {
  return curvesFor(channel, rolloffType, sub.error, sub.soFar, subStep(sub, cutoffHz, options), options.limitDb);
}

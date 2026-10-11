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

/** The Correct page chart's lines for one channel (`channel` is the target file's), all lined up at 1 kHz. */
export function previewCurves(
  channel: AdyChannel,
  rolloffType: RolloffType,
  correction: ChannelCorrection,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): PreviewCurves {
  const freq = logGrid();
  const target = effectiveTarget(channel, rolloffType);
  const trim = trimFromError(correction.error, freq, cutoffHz, options);
  return {
    freq,
    target,
    measured: target.map((v, i) => v + correction.error[i]),
    measuredWith: target.map((v, i) => v + correction.soFar[i]),
    corrected: target.map((v, i) => v + clampTotal(correction.soFar[i], trim(freq[i]), options.limitDb)),
  };
}

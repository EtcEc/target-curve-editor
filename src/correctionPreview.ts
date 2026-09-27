import type { AdyChannel } from './ady';
import { trimFromError, type ChannelCorrection } from './correction';
import { effectiveTarget, logGrid } from './measuredError';
import type { RolloffType } from './rolloff';

export interface PreviewCurves {
  freq: number[];
  /** What the file aims for now: its curve plus the HF rolloff. */
  current: number[];
  /** The measured response. */
  measured: number[];
  /** The target after the correction. */
  corrected: number[];
}

/** The Correct page chart's three lines for one channel, all lined up at 1 kHz. */
export function previewCurves(
  channel: AdyChannel,
  rolloffType: RolloffType,
  correction: ChannelCorrection,
  cutoffHz: number
): PreviewCurves {
  const freq = logGrid();
  const current = effectiveTarget(channel, rolloffType);
  const trim = trimFromError(correction.error, freq, cutoffHz);
  return {
    freq,
    current,
    measured: current.map((v, i) => v + correction.error[i]),
    corrected: current.map((v, i) => v + trim(freq[i])),
  };
}

import type { CurveParams } from './curve';

/**
 * One-line description of what the downloaded .ady will contain.
 * `trimmedChannels` must only list channels that actually get a measured trim.
 */
export function buildDownloadSummary(
  params: CurveParams,
  trimmedChannels: readonly string[],
  cutoffHz: number | null
): string {
  const curve = params.shelfEnabled
    ? `${params.slope} dB/oct tilt + ${params.shelfGain} dB bass shelf`
    : `${params.slope} dB/oct tilt, no bass shelf`;
  const trim =
    trimmedChannels.length > 0 && cutoffHz !== null
      ? `measured trim on ${trimmedChannels.join(', ')} above ${cutoffHz} Hz`
      : 'no measured correction';
  const parts = [curve, trim];
  if (params.cancelHfKnee === false) parts.push('HF rolloff cancellation off');
  return `Contains: ${parts.join('; ')}.`;
}

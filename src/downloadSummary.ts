import type { Band } from './bands';
import type { CurveParams } from './curve';

/** Number without trailing zeros, at most 2 decimals. */
function num(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${num(value)}`;
}

function describeBand(band: Band): string {
  switch (band.type) {
    case 'tilt': {
      let text = `${num(band.slope)} dB/oct tilt`;
      if (band.pivot !== 1000) text += ` around ${num(band.pivot)} Hz`;
      if (band.fLow > 20) text += ` (held below ${num(band.fLow)} Hz)`;
      if (band.fHigh < 20000) text += ` (held above ${num(band.fHigh)} Hz)`;
      return text;
    }
    case 'lowShelf':
      return `${signed(band.gain)} dB low shelf at ${num(band.freq)} Hz`;
    case 'highShelf':
      return `${signed(band.gain)} dB high shelf at ${num(band.freq)} Hz`;
    case 'bell':
      return `${signed(band.gain)} dB bell at ${num(band.freq)} Hz (Q ${num(band.q)})`;
  }
}

/**
 * One-line description of what the downloaded .ady will contain.
 * `trimmedChannels` must only list channels that actually get a measured trim.
 */
export function buildDownloadSummary(
  params: CurveParams,
  trimmedChannels: readonly string[],
  cutoffHz: number | null
): string {
  const enabled = params.bands.filter((b) => b.enabled);
  const curve = enabled.length > 0 ? enabled.map(describeBand).join(', ') : 'flat curve';
  const trim =
    trimmedChannels.length > 0 && cutoffHz !== null
      ? `measured trim on ${trimmedChannels.join(', ')} above ${cutoffHz} Hz`
      : 'no measured correction';
  const sub = params.subTrim ? 'sub trim applied' : 'sub trim skipped';
  const rolloff = `HF rolloff ${params.rolloffType} ${params.cancelRolloff ? 'cancelled' : 'not cancelled'}`;
  return `Contains: ${[curve, trim, sub, rolloff].join('; ')}.`;
}

/** Filename suffix that tells test variants apart from the normal export. */
export function buildFilenameSuffix(params: CurveParams, hasTrims: boolean): string {
  return (
    (params.cancelRolloff ? '' : '_no-knee-cancel') +
    (params.subTrim ? '' : '_no-sub-trim') +
    (hasTrims ? '_measured-trim' : '')
  );
}

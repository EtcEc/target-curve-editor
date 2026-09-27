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

/** One line of a download checklist; `on: false` lines are shown as "not applied". */
export interface ChecklistItem {
  text: string;
  on: boolean;
}

/** What the Design page's download will contain, one fact per line. */
export function designChecklist(
  params: CurveParams,
  subIds: readonly string[],
  subTrimShift: number
): ChecklistItem[] {
  const enabled = params.bands.filter((b) => b.enabled);
  const curve = enabled.length > 0 ? enabled.map(describeBand).join(', ') : 'flat';
  const items: ChecklistItem[] = [{ text: `Curve: ${curve}`, on: true }];
  items.push(
    params.cancelRolloff
      ? { text: `HF rolloff ${params.rolloffType} cancelled`, on: true }
      : { text: `HF rolloff ${params.rolloffType} left on`, on: false }
  );
  if (subIds.length === 0) items.push({ text: 'No subwoofer, so no sub trim', on: false });
  else if (params.subTrim) items.push({ text: `Sub trim ${signed(subTrimShift)} dB on ${subIds.join(', ')}`, on: true });
  else items.push({ text: 'Sub trim skipped', on: false });
  return items;
}

/** Filename suffix that tells test variants apart from the normal export. */
export function buildFilenameSuffix(params: CurveParams): string {
  return (params.cancelRolloff ? '' : '_no-knee-cancel') + (params.subTrim ? '' : '_no-sub-trim');
}

/** What the Correct page's download will contain. */
export function correctChecklist(channels: readonly string[], cutoffHz: number): ChecklistItem[] {
  const lo = Math.round(cutoffHz / Math.SQRT2);
  const hi = Math.round(cutoffHz * Math.SQRT2);
  return [
    {
      text: `Measured correction on ${channels.join(', ')}, fading in from ${lo} Hz to ${hi} Hz (cutoff ${cutoffHz} Hz)`,
      on: true,
    },
    { text: 'Unchanged below the fade; each curve keeps its level at 1 kHz', on: true },
    { text: 'Sub, channel levels and HF rolloff unchanged', on: true },
  ];
}

/** Download name for a corrected file, e.g. "Living_measured-500Hz.ady". */
export function measuredFilename(title: unknown, cutoffHz: number): string {
  const name = `measured-${Math.round(cutoffHz)}Hz.ady`;
  return typeof title === 'string' && title.length > 0 ? `${title}_${name}` : name;
}

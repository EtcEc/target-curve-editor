import { bandGain, sumBands, type Band } from './bands';

export const MIN_Q = 0.1;
export const MAX_Q = 20;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
/** Largest gain a drag can produce; further out is not useful on a -15..15 dB chart. */
const MAX_GAIN = 24;

/** The chart shows design + offset(f): 0 when the HF rolloff is cancelled, the rolloff when it is left on. */
export type ChartOffset = (freq: number) => number;

export interface Handle {
  freq: number;
  /** Height on the plotted curve, in dB. */
  y: number;
}

/**
 * Where band `index`'s handle sits on the chart: on the plotted curve at the
 * band's own frequency. Only enabled shelves and bells have one (a tilt has no
 * single point to drag).
 */
export function handleFor(bands: readonly Band[], index: number, offset: ChartOffset): Handle | null {
  const band = bands[index];
  if (!band || !band.enabled || band.type === 'tilt') return null;
  return { freq: band.freq, y: sumBands(band.freq, bands) + offset(band.freq) };
}

/**
 * The frequency and gain that put band `index`'s handle under the pointer at
 * (`freq`, `chartDb`). Exact rather than incremental: at its own frequency a
 * bell contributes its full gain and a shelf half of it, so the gain follows
 * from what the other bands already contribute there.
 */
export function dragBand(
  bands: readonly Band[],
  index: number,
  freq: number,
  chartDb: number,
  offset: ChartOffset
): { freq: number; gain: number } {
  const band = bands[index];
  if (!band || band.type === 'tilt') throw new Error('Only shelf and bell bands can be dragged');
  const f = Number(Math.min(MAX_FREQ, Math.max(MIN_FREQ, freq)).toPrecision(3));
  const others = sumBands(f, bands) - bandGain(f, band);
  const ownDb = chartDb - offset(f) - others;
  const gain = band.type === 'bell' ? ownDb : 2 * ownDb;
  // another band with unusable values makes the sum non-finite: leave this band alone
  if (!Number.isFinite(gain)) return { freq: band.freq, gain: band.gain };
  const bounded = Math.min(MAX_GAIN, Math.max(-MAX_GAIN, gain));
  return { freq: f, gain: Math.round(bounded * 10) / 10 };
}

/**
 * New Q after a wheel event: 10% per 100 units of scroll (one notch of a mouse
 * wheel), scrolling up = sharper. Proportional, so a trackpad's many small events
 * add up to a gentle change; one event counts for at most three notches.
 */
export function scaleQ(q: number, wheelDeltaY: number): number {
  if (!Number.isFinite(wheelDeltaY) || wheelDeltaY === 0) return q;
  const notches = Math.min(3, Math.max(-3, wheelDeltaY / 100));
  return Math.min(MAX_Q, Math.max(MIN_Q, q * 1.1 ** -notches));
}

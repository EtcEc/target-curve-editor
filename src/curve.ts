import { sumBands, type Band } from './bands';
import { rolloffGain, type RolloffType } from './rolloff';

/**
 * Frequency grid matching the original Python scripts: 1Hz steps from
 * 20-200Hz, 10Hz steps from 200-20000Hz, always ending exactly at 20000.
 */
export function frequencyGrid(): number[] {
  const grid: number[] = [];
  for (let f = 20; f < 200; f += 1) grid.push(f);
  for (let f = 200; f < 20000; f += 10) grid.push(f);
  if (grid[grid.length - 1] !== 20000) grid.push(20000);
  return grid;
}

/** Extra gain (dB) added on top of a channel's written curve, as a function of frequency. */
export type TrimFn = (freq: number) => number;

export interface CurveParams {
  /** The design curve is the plain sum of these bands. */
  bands: Band[];
  /** Which of Audyssey's two fixed HF rolloff shapes the AVR applies (enTargetCurveType). */
  rolloffType: RolloffType;
  /**
   * Pre-cancel that rolloff in the written curve so the design is what you
   * actually get. Untick to write the design as is; the listener then also
   * gets the rolloff on top.
   */
  cancelRolloff: boolean;
  /** Shift the subwoofer's trimAdjustment to compensate Audyssey's 0dB-max renormalisation. */
  subTrim: boolean;
}

/** Smooth 0->1 ease with zero slope at both ends. */
export function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** The curve you are designing: the sum of the enabled bands. */
export function designGain(freq: number, params: CurveParams): number {
  return sumBands(freq, params.bands);
}

/**
 * The curve actually written to the .ady file: the design with the selected
 * HF rolloff pre-cancelled (unless cancelRolloff is false), so the design is
 * what you get after Audyssey applies its own rolloff on top.
 */
export function writtenGain(freq: number, params: CurveParams): number {
  const design = designGain(freq, params);
  return params.cancelRolloff ? design - rolloffGain(params.rolloffType, freq) : design;
}

/** What the listener gets: the written curve plus the rolloff Audyssey always applies. This is what the chart shows. */
export function resultGain(freq: number, params: CurveParams): number {
  return writtenGain(freq, params) + rolloffGain(params.rolloffType, freq);
}

/** What the chart adds to the design curve: nothing when the rolloff is cancelled, the rolloff itself when it is left on. */
export function chartOffset(freq: number, params: CurveParams): number {
  return params.cancelRolloff ? 0 : rolloffGain(params.rolloffType, freq);
}

/** The highest point of the written curve on the write grid, and where it is. */
export function writtenPeak(params: CurveParams): { freq: number; gain: number } {
  let peak = { freq: 20, gain: -Infinity };
  for (const f of frequencyGrid()) {
    const gain = writtenGain(f, params);
    if (gain > peak.gain) peak = { freq: f, gain };
  }
  return peak;
}

/**
 * The amount Audyssey will shift a subwoofer's curve down to normalize its
 * max to 0dB -- and therefore the trim boost needed to restore the
 * absolute level you designed.
 */
export function computeTrimShift(params: CurveParams): number {
  return writtenPeak(params).gain;
}

/** The highest point at or below this frequency is what a subwoofer's own range can reach. */
const SUB_RANGE_HZ = 200;

/**
 * The written curve's peak when it sits well above the sub's range (more than
 * 0.5 dB over the highest point at or below 200 Hz), otherwise null. That is the
 * case worth telling the user about, because the sub trim then follows a point
 * the sub never plays.
 */
export function subTrimPeakAboveSub(params: CurveParams): { freq: number; gain: number } | null {
  const peak = writtenPeak(params);
  if (peak.freq <= SUB_RANGE_HZ) return null;
  let subMax = -Infinity;
  for (const f of frequencyGrid()) {
    if (f > SUB_RANGE_HZ) break;
    subMax = Math.max(subMax, writtenGain(f, params));
  }
  return peak.gain - subMax > 0.5 ? peak : null;
}

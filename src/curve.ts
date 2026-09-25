import { sumBands, type Band } from './bands';
import { rolloffGain, type RolloffType } from './rolloff';

const PIVOT_FREQ = 1000;

/** Down-tilt gain in dB at `freq`, `slope` dB/octave, 0dB at 1kHz. */
export function tilt(freq: number, slope: number): number {
  return slope * Math.log2(PIVOT_FREQ / freq);
}

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

/**
 * The amount Audyssey will shift a subwoofer's curve down to normalize its
 * max to 0dB -- and therefore the trim boost needed to restore the
 * absolute level you designed.
 */
export function computeTrimShift(params: CurveParams): number {
  const grid = frequencyGrid();
  let max = -Infinity;
  for (const f of grid) {
    const g = writtenGain(f, params);
    if (g > max) max = g;
  }
  return max;
}

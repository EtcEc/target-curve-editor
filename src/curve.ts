import { hfKneeGain } from './hfKnee';

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

/**
 * Fixed breakpoints (Hz) for the shelf<->tilt crossfade. Not user-exposed:
 * below SHELF_LOW_FREQ the curve sits flat at shelfGain; at/above
 * SHELF_HIGH_FREQ it's pure tilt, unaffected by the shelf.
 */
const SHELF_LOW_FREQ = 40;
const SHELF_HIGH_FREQ = 100;

/** Extra gain (dB) added on top of a channel's written curve, as a function of frequency. */
export type TrimFn = (freq: number) => number;

export interface CurveParams {
  /** dB/octave. Positive tilts down toward treble, up toward bass. */
  slope: number;
  shelfEnabled: boolean;
  /** Flat plateau gain (dB) the curve sits at below ~40Hz. Only used when shelfEnabled. */
  shelfGain: number;
  /**
   * Pre-cancel Audyssey's fixed HF rolloff in the written curve. Defaults to
   * true. Turn off to write the raw designed curve instead -- a diagnostic for
   * checking whether the AVR actually applies that rolloff on top of custom
   * points, or whether it's only drawn in the MultEQ app's Curve Editor.
   */
  cancelHfKnee?: boolean;
}

/** Smooth 0->1 ease with zero slope at both ends. */
export function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * The curve you're designing: down-tilt, optionally crossfading into a flat
 * bass shelf below ~40Hz. This is what the live preview chart plots. Below
 * SHELF_LOW_FREQ the result is exactly shelfGain; at/above SHELF_HIGH_FREQ
 * it's exactly tilt(freq, slope) -- the shelf has no influence on the rest
 * of the curve, including the HF-knee cancellation region.
 */
export function designGain(freq: number, params: CurveParams): number {
  const t = tilt(freq, params.slope);
  if (!params.shelfEnabled) return t;
  const x =
    (Math.log2(freq) - Math.log2(SHELF_LOW_FREQ)) /
    (Math.log2(SHELF_HIGH_FREQ) - Math.log2(SHELF_LOW_FREQ));
  const weight = smoothstep(x);
  return params.shelfGain * (1 - weight) + t * weight;
}

/**
 * The curve actually written to the .ady file: the designed curve with
 * Audyssey's fixed HF-knee rolloff pre-cancelled (unless cancelHfKnee is
 * false), so what you designed is what you actually get after Audyssey
 * applies its own knee on top.
 */
export function writtenGain(freq: number, params: CurveParams): number {
  const design = designGain(freq, params);
  return params.cancelHfKnee === false ? design : design - hfKneeGain(freq);
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

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

/** Fixed knee-width (octaves) for the smooth tilt->shelf transition. Not user-exposed. */
const SHELF_KNEE_OCTAVES = 0.5;

export interface CurveParams {
  /** dB/octave. Positive tilts down toward treble, up toward bass. */
  slope: number;
  shelfEnabled: boolean;
  /** dB ceiling the bass shelf caps the tilt at. Only used when shelfEnabled. */
  shelfGain: number;
}

function softmin(a: number, b: number, k: number): number {
  return (-1 / k) * Math.log(Math.exp(-k * a) + Math.exp(-k * b));
}

/**
 * The curve you're designing: down-tilt, optionally capped by a smooth
 * bass shelf. This is what the live preview chart plots. Assumes a
 * positive slope when the shelf is enabled (a shelf only makes sense as a
 * cap on a rising-toward-bass tilt).
 */
export function designGain(freq: number, params: CurveParams): number {
  const t = tilt(freq, params.slope);
  if (!params.shelfEnabled) return t;
  const k = 2 / (params.slope * SHELF_KNEE_OCTAVES);
  return softmin(t, params.shelfGain, k);
}

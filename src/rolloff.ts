import hfKneeData from './hfKneeData.json';
import hfRolloff1Data from './hfRolloff1Data.json';

/**
 * Audyssey applies one of two fixed HF rolloff shapes on top of any custom
 * curve, selected by the .ady's top-level `enTargetCurveType`:
 *   1 = "High Frequency Roll Off 1", 2 = "High Frequency Roll Off 2".
 * Both are stored as the raw points read off MultEQ-X's Curve Editor and
 * interpolated directly (log-frequency linear interpolation) rather than
 * fitted to a formula -- a fitted curve left a visible residual against what
 * Audyssey actually applies.
 */
export type RolloffType = 1 | 2;
export const ROLLOFF_TYPES: readonly RolloffType[] = [1, 2];

export function isRolloffType(value: number): value is RolloffType {
  return value === 1 || value === 2;
}

interface Table {
  frequency: number[];
  gain: number[];
}

function makeInterpolator(table: Table): (freq: number) => number {
  const logFreq = table.frequency.map((f) => Math.log10(f));
  const gains = table.gain;
  const last = logFreq.length - 1;
  return (freq: number): number => {
    const x = Math.log10(freq);
    if (x <= logFreq[0]) return gains[0];
    if (x >= logFreq[last]) return gains[last];
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (logFreq[mid] <= x) lo = mid;
      else hi = mid;
    }
    const span = logFreq[hi] - logFreq[lo];
    const t = span === 0 ? 0 : (x - logFreq[lo]) / span;
    return gains[lo] + t * (gains[hi] - gains[lo]);
  };
}

const interpolators: Record<RolloffType, (freq: number) => number> = {
  1: makeInterpolator(hfRolloff1Data),
  2: makeInterpolator(hfKneeData),
};

/** dB gain of the given Audyssey HF rolloff at `freq` (Hz). */
export function rolloffGain(type: RolloffType, freq: number): number {
  return interpolators[type](freq);
}

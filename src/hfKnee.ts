import { rolloffGain } from './rolloff';

/** dB gain of Audyssey's High Frequency Roll Off 2 (enTargetCurveType 2). Kept for existing callers. */
export function hfKneeGain(freq: number): number {
  return rolloffGain(2, freq);
}

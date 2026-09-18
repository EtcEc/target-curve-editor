import hfKneeData from './hfKneeData.json';

/**
 * Audyssey MultEQ's default HF double-knee rolloff (enTargetCurveType === 2),
 * extracted once from a reference target-curve screenshot -- see
 * docs/superpowers/specs/2026-09-18-target-curve-editor-design.md for how
 * this was captured. Interpolated directly from the raw extracted points
 * (log-frequency linear interpolation, matching the original Python
 * script's np.interp technique exactly) rather than approximating them
 * with a fitted formula -- a fitted curve introduced a small but real
 * residual against Audyssey's actual applied shape that this avoids.
 */

const FREQUENCIES: number[] = hfKneeData.frequency;
const GAINS: number[] = hfKneeData.gain;
const LOG_FREQUENCIES: number[] = FREQUENCIES.map((f) => Math.log10(f));

/** dB gain of Audyssey's default HF double-knee rolloff at `freq` (Hz). */
export function hfKneeGain(freq: number): number {
  const logFreq = Math.log10(freq);
  const first = 0;
  const last = LOG_FREQUENCIES.length - 1;

  if (logFreq <= LOG_FREQUENCIES[first]) return GAINS[first];
  if (logFreq >= LOG_FREQUENCIES[last]) return GAINS[last];

  let lo = first;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (LOG_FREQUENCIES[mid] <= logFreq) lo = mid;
    else hi = mid;
  }

  const span = LOG_FREQUENCIES[hi] - LOG_FREQUENCIES[lo];
  const t = span === 0 ? 0 : (logFreq - LOG_FREQUENCIES[lo]) / span;
  return GAINS[lo] + t * (GAINS[hi] - GAINS[lo]);
}

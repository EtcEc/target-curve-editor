/**
 * Audyssey MultEQ's default HF double-knee rolloff (enTargetCurveType === 2),
 * fitted once from a reference target-curve screenshot. See
 * docs/superpowers/specs/2026-09-18-target-curve-editor-design.md for
 * derivation. Ported from hf_knee.py.
 *
 * gain(f) = G1 * r1/(1+r1) + G2 * r2/(1+r2),  ri = (f / f0i) ** ni
 * Fit quality against the extracted curve: RMS 0.032 dB, max error 0.16 dB.
 */

const G1 = -2.9865;
const F01 = 6352.62;
const N1 = 6.4001;

const G2 = -5.0943;
const F02 = 18176.89;
const N2 = 3.4201;

function shelf(freq: number, gain: number, f0: number, n: number): number {
  const ratio = (freq / f0) ** n;
  return (gain * ratio) / (1 + ratio);
}

/** dB gain of Audyssey's default HF double-knee rolloff at `freq` (Hz). */
export function hfKneeGain(freq: number): number {
  return shelf(freq, G1, F01, N1) + shelf(freq, G2, F02, N2);
}

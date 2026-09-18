"""
Audyssey MultEQ's default HF double-knee rolloff, fitted once from a
reference target-curve screenshot and stored parametrically so the app's
image doesn't need to be read again.

Fitted as a sum of two shelving-filter-shaped terms in dB:

    gain(f) = G1 * r1/(1+r1) + G2 * r2/(1+r2),  ri = (f / f0i) ** ni

Fit quality against the extracted curve: RMS 0.032 dB, max error 0.16 dB.
"""
import numpy as np

_G1, _F01, _N1 = -2.9865, 6352.62, 6.4001
_G2, _F02, _N2 = -5.0943, 18176.89, 3.4201


def _shelf(freq, gain, f0, n):
    ratio = (freq / f0) ** n
    return gain * ratio / (1 + ratio)


def hf_knee_gain(freq):
    """dB gain of Audyssey's default HF double-knee rolloff at `freq` (Hz)."""
    freq = np.asarray(freq, dtype=float)
    return _shelf(freq, _G1, _F01, _N1) + _shelf(freq, _G2, _F02, _N2)

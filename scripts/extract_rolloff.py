"""
One-off extraction of an Audyssey HF rolloff shape from a MultEQ-X "Curve
Editor" screenshot taken with no custom points (the red line is then the
rolloff alone). Writes a raw {frequency, gain} table in the same format as
src/hfKneeData.json.

    uv run --with pillow --with numpy python scripts/extract_rolloff.py \
        "<screenshot.png>" src/hfRolloff1Data.json

The calibration constants below are for the specific 2556x1179 px screenshot
this table was made from ("High Frequency Roll Off 1"). The script re-detects
the plot gridlines and refuses to run if they do not match the constants.
The screenshot itself is NOT committed.
"""
import json
import sys

import numpy as np
from PIL import Image

X_100HZ, X_10KHZ = 719.0, 2091.0    # pixel columns of the 100 Hz and 10 kHz gridlines
Y_PLUS20, Y_MINUS25 = 249.0, 875.0  # pixel rows of the +20 dB and -25 dB gridlines
X_FIRST, X_LAST = 240, 2297         # first/last pixel column of the plot (20 Hz .. 20 kHz)
PLOT = (236, 2302, 246, 948)        # x0, x1, y0, y1 of the plot area, for gridline detection
FLAT_BELOW_HZ = 3000.0              # the curve is visibly flat here; pixel noise is +-0.05 dB
X_TAIL_TRUSTED = 2288               # the red line has a rounded end: past this column its thickness shrinks
                                    # (9 px -> 4 px) and the mean height stops following the curve
TAIL_FIT_COLUMNS = 24               # the trend before that point is extrapolated with a straight line


def groups(indices):
    out, start, prev = [], indices[0], indices[0]
    for v in indices[1:]:
        if v != prev + 1:
            out.append((start + prev) / 2)
            start = v
        prev = v
    out.append((start + prev) / 2)
    return out


def check_calibration(img):
    x0, x1, y0, y1 = PLOT
    gray = img[y0:y1, x0:x1].sum(axis=2) / 3
    lines = (gray > 35) & (gray < 200)
    rows = groups(np.where(lines.mean(axis=1) > 0.5)[0] + y0)
    cols = groups(np.where(lines.mean(axis=0) > 0.5)[0] + x0)
    for name, want, found in (
        ("+20 dB row", Y_PLUS20, rows), ("-25 dB row", Y_MINUS25, rows),
        ("100 Hz column", X_100HZ, cols), ("10 kHz column", X_10KHZ, cols),
    ):
        if min(abs(f - want) for f in found) > 1.5:
            sys.exit(f"Calibration mismatch: no gridline near {name} ({want}); found {found}")


def main(png_path, out_path):
    img = np.array(Image.open(png_path).convert("RGB")).astype(int)
    check_calibration(img)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    red = (r > 170) & (g < 100) & (b < 100)

    px_per_decade = (X_10KHZ - X_100HZ) / 2
    px_per_db = (Y_MINUS25 - Y_PLUS20) / 45
    y_zero = Y_PLUS20 + 20 * px_per_db

    cols, freqs, raw = [], [], []
    for x in range(X_FIRST, X_LAST + 1):
        ys = np.where(red[:, x])[0]
        if len(ys) == 0:
            continue
        cols.append(x)
        freqs.append(100 * 10 ** ((x - X_100HZ) / px_per_decade))
        raw.append((y_zero - ys.mean()) / px_per_db)
    cols, freqs, raw = np.array(cols), np.array(freqs), np.array(raw)

    # replace the distorted tail (rounded line end) by the straight-line trend of the columns before it
    fit = (cols > X_TAIL_TRUSTED - TAIL_FIT_COLUMNS) & (cols <= X_TAIL_TRUSTED)
    slope, intercept = np.polyfit(cols[fit], raw[fit], 1)
    tail = cols > X_TAIL_TRUSTED
    raw[tail] = slope * cols[tail] + intercept

    # the plot ends exactly at 20 kHz, slightly past the last red column: add that point explicitly
    x_20khz = X_100HZ + (np.log10(20000) - 2) * px_per_decade
    freqs = np.append(freqs, 20000.0)
    raw = np.append(raw, slope * x_20khz + intercept)

    gains = [0.0 if f <= FLAT_BELOW_HZ else round(float(g), 4) for f, g in zip(freqs, raw)]
    freqs = [round(float(f), 4) for f in freqs]

    with open(out_path, "w") as fh:
        json.dump({"frequency": freqs, "gain": gains}, fh)
    f_arr, g_arr = np.array(freqs), np.array(gains)
    print(f"{len(freqs)} points, {f_arr.min():.1f}-{f_arr.max():.1f} Hz")
    for hz in (3000, 5000, 8000, 10000, 15000, 20000):
        i = int(np.argmin(abs(f_arr - hz)))
        print(f"  {hz:>6} Hz  {g_arr[i]:6.2f} dB")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

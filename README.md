# Audyssey Target Curve Editor

A static, client-side web tool: drop in an Audyssey MultEQ `.ady` file, design a
target curve, see it live on a chart, and download a modified `.ady`. Live at
https://etcec.github.io/target-curve-editor/. Nothing is uploaded; everything
runs in the browser.

## What it does

The start page offers two jobs:

1. **Design a target curve.** Load the raw `.ady` from MultEQ-X and design the
   curve as a sum of bands (tilt, low/high shelf, bell). Start from a preset,
   edit bands, or drag a shelf/bell handle on the chart (scroll over a handle to
   change its Q). Choose Audyssey's HF rolloff type (read from the file), whether
   to cancel it, and whether to compensate the sub trim. Save the design into
   compare slot A, B or C to see it drawn faintly while you keep editing, or save
   it as a small JSON file. Download the `.ady`.
2. **Apply a measured correction.** Load a `.ady` this tool made, the one that
   was on the AVR when you took REW measurements, and add the REW exports per
   speaker. The page shows each speaker's current target, measurement and
   corrected target, and downloads the file with the correction added on top of
   its own curves (lined up and pinned at 1 kHz, nothing below the cutoff,
   sub trim and channel levels untouched). Load the result on the AVR, measure
   again and repeat to refine.

Design files are `{ "version": 1, "name", "bands", "cancelRolloff" }`. The HF
rolloff type is not in them; it comes from the `.ady`.

Real `.ady` files and measurements are personal data and are never committed.

## Development

Node 20.

```
npm install
npm run dev        # local dev server
npm test           # unit tests (synthetic data only)
npm run build
```

An opt-in check against a real measurement session is in
`scripts/acceptance.local.test.ts` (see its header for the environment
variables). Design notes and plans are in `docs/superpowers/`.

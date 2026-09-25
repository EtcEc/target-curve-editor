# Audyssey Target Curve Editor

A static, client-side web tool: drop in an Audyssey MultEQ `.ady` file, design a
target curve, see it live on a chart, and download a modified `.ady`. Live at
https://etcec.github.io/target-curve-editor/. Nothing is uploaded; everything
runs in the browser.

## What it does

1. **Load** the raw `.ady` from MultEQ-X.
2. **Design the curve** as a sum of bands (tilt, low/high shelf, bell). Start
   from a preset, add and edit bands, or drag a shelf/bell handle on the chart
   (scroll over a handle to change its Q). Choose Audyssey's HF rolloff type
   (read from the file) and whether to cancel it, and whether to compensate the
   sub trim.
3. **Compare** designs: save the current one into slot A, B or C and see it
   drawn faintly while you keep editing. Save a design as a small JSON file and
   load it again, for example to share it.
4. **Measured correction (optional):** build a `correction.json` from REW
   measurements (per-speaker trim above an adjustable cutoff) and apply it on
   top of the curve.
5. **Download** the corrected `.ady`. A line above the button states exactly
   what it contains.

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

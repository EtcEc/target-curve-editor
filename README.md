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
2. **Apply a measured correction.** Load your target `.ady` (the one the Design
   page made) and, from round 2 on, also the `.ady` that was on the AVR when you
   took the REW measurements. Add the REW exports per speaker. The page compares
   the measurements with your target and shows, per speaker, the target, the
   measurement, the curve you measured with and the new curve. The download is
   the measured-with file with each corrected curve set to your target plus the
   correction so far plus this round's step (lined up and pinned at 1 kHz,
   fading in around the cutoff, never more than the limit from your target; sub
   trim and channel levels untouched). Load it on the AVR, measure again, and
   repeat with it as the measured-with file.
   The sub is corrected too ("Correct the sub", on by default): what every
   measured speaker has in common in the bass is the sub playing, so that part
   goes to the sub, below about twice the crossover, while each speaker gets
   its own error. The sub's trim moves with its curve's peak so its level stays
   where it was. The cutoff defaults to 0 (full range); set it higher to leave
   everything below it alone.

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

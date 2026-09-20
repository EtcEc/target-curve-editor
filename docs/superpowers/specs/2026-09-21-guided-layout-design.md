# Guided Layout — Design

## Problem

After the measured-correction feature, the page mixes two jobs (design a curve
and export; create a correction from measurements) in one nested collapsible
stack. It never says which `.ady` is which, and the download button does not say
what it will contain.

## Layout

A visible, numbered top-to-bottom flow. No nested collapsibles for the main path.

1. **Load your .ady.** Copy: "The raw file from MultEQ-X: your starting point."
   This is the file the export edits. (The existing dropzone.)
2. **Design the curve.** Existing controls, chart and channel table, unchanged.
3. **Measured correction (optional).**
   - Always visible (not in a `<details>`): a file input for `correction.json`,
     the "Apply correction" checkbox, the Cutoff field, the summary table and the
     ignored-channels notice (existing behaviour, same ids).
   - A secondary control below it, "No correction file yet? Create one from
     measurements", opens a separate panel (a `<details>` is fine) for the
     generate flow. That panel works even before a base `.ady` is loaded, so it
     must not live inside the hidden `#editor` section's dependency chain: the
     generate flow needs no base file.
   - The panel opens with a short explanation of the two `.ady` files:
     "Load the base .ady in step 1 (raw, what you edit and export). Here, pick
     the .ady you measured with: the one saved from the calibration you
     measured, which carries the target curve. It tells the tool what each
     speaker was aiming for."
   - Generating loads the result as the active correction (existing behaviour),
     and step 3 shows it as loaded, with a status line.
4. **Download.** A summary line directly above the button states exactly what
   the file will contain, updated live, e.g.
   "Contains: 0.7 dB/oct tilt + 4.5 dB bass shelf; measured trim on FL, FR, C
   above 2000 Hz." or "…; no measured correction." Also states when the HF knee
   cancellation is off ("HF rolloff cancellation off"). The button itself keeps
   its label.

## Non-goals

No changes to math, file formats, validation, or the export filename rules. No
new dependencies. Steps are headings/labels, not a wizard (nothing is locked).

## Notes

- Keep every existing element id that `main.ts`/`correctionUi.ts` use unless the
  code is updated with it; a static check that every `getElementById`/`el()` id
  exists in `index.html` must pass.
- If the generate panel moves outside `#editor`, it must still work with no base
  `.ady` loaded (`setBaseChannels` not yet called).
- The download summary must reflect `hasAppliedTrims` (only claim trims on
  channels that actually get one).
- Verified manually in the browser (no DOM unit tests in this project).

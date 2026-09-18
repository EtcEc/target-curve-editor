# Target Curve Editor — Design

## Purpose

A GitHub Pages web app: drop in an Audyssey MultEQ `.ady` calibration file,
design a target curve (down-tilt + optional bass shelf), and download a
modified `.ady` with that curve applied to every channel — replacing
Audyssey's default reference curve while correctly compensating for
Audyssey's own fixed behaviors (the HF double-knee it always layers on top,
and the subwoofer-only level renormalization it performs).

This replaces the existing Python scripts (`create_correction.py`,
`create_correction_shelved.py`, the per-channel image-reading workflow)
entirely. The one artifact carried forward from that work is the
extracted HF-knee reference data (`hfKneeData.json`, interpolated
directly by `hfKnee.ts`).

## Background (established this session)

- `.ady` files are JSON. Each entry in `detectedChannels[]` is one speaker
  channel, identified by `commandId` (e.g. `FL`, `C`, `SW1`). Subwoofer
  channel(s) are identified by `commandId` starting with `"SW"` — there can
  be more than one, and the channel *count and indices are not fixed*
  (observed: 10 channels, indices 0–9, sub at index 9 — do not assume a
  fixed layout or count).
- `enTargetCurveType` (top-level) selects which fixed HF rolloff shape
  Audyssey applies on top of any custom curve. This project only models
  one such shape (see below); the app must force this field to the
  matching value (`2`) in its output regardless of the input value, or the
  HF-knee cancellation below is invalid.
- Audyssey applies a static, always-on HF "double knee" rolloff on top of
  whatever `customTargetCurvePoints` you provide (confirmed for
  `enTargetCurveType == 2`; a second, different rolloff shape exists for
  another `enTargetCurveType` value, not modeled here). This was extracted
  from a reference screenshot as ~2000 raw (frequency, gain) pixel-derived
  points and is interpolated directly (log-frequency linear interpolation,
  matching the original Python script's `np.interp` technique) rather than
  fitted to a formula. A 6-parameter double-shelf-sigmoid fit was tried
  first (RMS 0.032dB / max 0.16dB against the extracted points) but was
  abandoned: importing a corrected `.ady` and inspecting the resulting
  curve in MultEQ's own Curve Editor showed a smooth, systematically
  growing residual (~0.7dB by 20kHz) that direct point interpolation
  (which is what the old, known-good Python script always did) doesn't
  produce. The raw points live in `hfKneeData.json` (repo root of `src/`);
  `hfKnee.ts` interpolates them directly.
- For the **subwoofer channel(s) only**, Audyssey renormalizes the custom
  curve so its max value sits at 0dB before applying it (turning it into a
  cuts-only curve), and does *not* do this for any other channel type.
  To get the intended absolute level back, the app must compute that shift
  and add it to the subwoofer's `trimAdjustment`.
- Corrections are intentionally scoped to what the target-curve definition
  controls (tilt/shelf shape + the HF-knee cancellation). Audyssey's own
  measurement-based room correction still does the actual per-channel,
  per-room EQ work to try to hit the specified target — this app does not
  attempt to predict or cancel that.

## Non-goals (v1)

- The second HF-rolloff shape (different `enTargetCurveType`) — out of
  scope, not extracted or modeled.
- The ~2kHz midrange-compensation dip (`midrangeCompensation` per-channel
  flag) — a separate, independent option; not modeled or toggled by this
  app.
- Any server component, file storage, or analytics — fully static,
  fully client-side.
- Automated UI/e2e testing — manual browser verification is sufficient
  for this scope.

## Architecture

Static single-page app: **TypeScript + Vite, no UI framework**. Built
`dist/` published to GitHub Pages via a GitHub Actions workflow on push to
the default branch. Repo is public (required for free GH Pages hosting).

Modules:

- `ady.ts` — parse/validate/serialize `.ady` JSON; channel introspection
  (locate subwoofer channels by `commandId` prefix `"SW"`).
- `curve.ts` — pure math: tilt, smooth shelf crossfade, combination with the
  HF-knee inverse, subwoofer trim computation.
- `hfKnee.ts` — interpolates the extracted HF-knee reference points
  (`hfKneeData.json`) directly; no fitted formula.
- `chart.ts` — thin wrapper around a small charting lib (uPlot) for the
  live preview.
- `ui.ts` / `main.ts` — file drop zone, parameter controls, live chart,
  channel summary, download button.

## Curve math

```
tilt(f)     = slope * log2(1000 / f)                          # dB, slope in dB/octave
                                                                # 0dB at 1kHz (fixed pivot)
                                                                # positive slope: boost toward
                                                                # bass, cut toward treble

# bass shelf (optional, toggled on/off):
#   a flat plateau at shelfGain dB below ~40Hz, crossfading smoothly
#   into the plain tilt by ~100Hz. This is NOT additive (tilt + shelf)
#   and NOT a cap on the tilt (min(tilt, shelfGain)) -- both of those
#   were tried and rejected: additive double-stacks in the transition
#   band, and a cap can never exceed what the tilt alone would give,
#   so gentle slopes (e.g. 0.7 dB/oct) never reach the shelf value at
#   all. This is a genuine crossfade between two curves.
SHELF_LOW_FREQ = 40    # Hz, fixed constant, not user-exposed
SHELF_HIGH_FREQ = 100  # Hz, fixed constant, not user-exposed
smoothstep(t) = clamp(t, 0, 1)^2 * (3 - 2*clamp(t, 0, 1))       # 0->1 ease, zero slope at both ends

weight(f) = smoothstep((log2(f) - log2(SHELF_LOW_FREQ)) / (log2(SHELF_HIGH_FREQ) - log2(SHELF_LOW_FREQ)))

design(f)   = shelfGain*(1 - weight(f)) + tilt(f)*weight(f)   if shelf enabled
            = tilt(f)                                         if shelf disabled

written(f)  = design(f) - hfKneeGain(f)        # pre-cancels Audyssey's fixed HF knee
```

At `f <= 40Hz`, `design(f) === shelfGain` exactly (weight is 0). At `f >= 100Hz`,
`design(f) === tilt(f)` exactly (weight is 1) -- the shelf has zero influence
on the mids/treble or the HF-knee cancellation. At `slope = 0` this reproduces
a literal reference shelf shape: flat `shelfGain` below 40Hz, flat 0dB from
100Hz up to 20kHz.

Known limitation, not addressed: for a slope steep enough that `tilt(f)` at
the 40-100Hz breakpoints already exceeds `shelfGain`, the crossfade produces
a non-monotonic bump (the curve dips to `shelfGain` below 40Hz, rises above
it through the transition band, then continues following the steeper tilt).
This doesn't affect the intended use case (a gentle tilt with a shelf adding
extra bass beyond what the tilt alone provides) and wasn't flagged as a
requirement to fix.

`design(f)` is what the live chart plots (what you'll actually hear).
`written(f)` is what actually goes into the file.

Frequency grid: same as the old scripts — 1Hz steps 20–200Hz, 10Hz steps
200–20000Hz.

## Output file changes

For every channel in `detectedChannels[]`:

- `customTargetCurvePoints` = `written(f)` sampled on the frequency grid
  above, formatted as `"{freq, gain}"` strings (matching existing format).

For channels whose `commandId` starts with `"SW"` only:

- `trimShift = max(written(f))` over the frequency grid
- `trimAdjustment` = original value + `trimShift` (as a string, same
  format/precision as the source field)

Top-level:

- `enTargetCurveType` = `2` (forced, regardless of input value)

Everything else in the file (`responseData`, `delayAdjustment`,
`channelReport`, `customCrossover`, etc.) is passed through unmodified.

## UI & data flow

1. **Drop zone** (drag-and-drop or file picker). On load: `JSON.parse`,
   then validate shape — `detectedChannels` is a non-empty array, each
   entry has `commandId`, `customTargetCurvePoints`, `trimAdjustment`;
   top-level has `enTargetCurveType`. Invalid → clear error message, no
   further UI.
2. **Controls** (shown once a valid file is loaded):
   - Slope (dB/octave): number input + slider
   - Bass shelf: on/off toggle; when on, a Shelf Gain (dB) input
3. **Live chart**: updates on every control change, plots `design(f)`.
   Log X-axis 20Hz–20kHz, dB Y-axis, styled similar to the Audyssey app's
   own graphs.
4. **Channel summary**: table of detected channels, flags which are
   treated as subwoofers, shows the computed trim shift. If zero
   subwoofer channels are detected, show a visible warning (processing
   still proceeds — trim step is simply skipped).
5. **Download button**: serializes the modified JSON, triggers a browser
   download named `<title>_corrected.ady` (falling back to
   `corrected.ady` if `title` is missing).

Nothing is ever sent off the device — all parsing, computation, and file
generation happens in-browser.

## Error handling

- Invalid JSON / missing required fields on upload → block with a clear
  message; no partial processing.
- No subwoofer channel detected → proceed, but show a visible warning
  (see UI section).
- No clamping of user-entered slope/shelf values — the live chart is the
  guardrail against nonsensical designs, not input validation.

## Testing

- `curve.ts`: unit tests for `tilt`, `softmin`, the tilt+shelf
  combination, the HF-knee-inverse subtraction, and the trim
  calculation — pure, deterministic functions, written test-first.
- `hfKnee.ts`: a test asserting the reference points fitted this session
  (e.g. gain ≈ 0 at 1kHz, gain ≈ -6.1dB at 20kHz) so a future refit can't
  silently drift.
- `ady.ts`: parsing/validation/serialization tests against a **synthetic
  fixture** — a small hand-built fake `.ady` with a few channels
  (including one `SW1`) and minimal dummy `responseData` arrays. The
  real `Default.ady` in this repo is personal calibration data and is
  gitignored (`*.ady`); it must never be used as a committed test
  fixture.
- No automated UI/e2e tests for v1; manual browser verification.

## Open items carried into implementation planning

None — all sections above were reviewed and approved section-by-section
during design.

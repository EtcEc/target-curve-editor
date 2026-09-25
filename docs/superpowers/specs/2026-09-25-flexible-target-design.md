# Flexible Target Design — Design

## Purpose

The target curve controls (one slope, one bass shelf with a fixed shape) are
shaped around a single known-good setup. This design makes the curve a list of
editable bands so other shapes can be tried, adds Audyssey's second HF rolloff
shape, makes the rolloff visible on the chart, and adds an option for the
sub trim compensation. It amends the original design
(`2026-09-18-target-curve-editor-design.md`); anything not mentioned here is
unchanged.

## Scope and phasing

- **Phase 1** (this spec's first implementation plan): band model (tilt, low/high
  shelf, bell), presets, both HF rolloff types, rolloff shown on the chart,
  sub trim option with detection.
- **Phase 2** (its own plan later): draggable handles on the chart, saved compare
  slots, saving/loading a design as a file.

Both phases are specified here so Phase 1 makes room for Phase 2.

## Curve model

The design curve `design(f)` is the plain sum of a list of bands, each a
standard, well-understood filter response in dB. No band changes how another
one behaves.

Band types:

- **Tilt**: `slope` (dB/oct, positive = falling), `pivot` (Hz, default 1000),
  optional range `fLow`/`fHigh` (default 20/20000 = unlimited). The value is
  `slope * log2(pivot / clamp(f, fLow, fHigh))`, i.e. it holds its edge value
  outside the range (continuous, no step). Setting `fLow` is how a bass plateau
  is made: the tilt stops rising below `fLow`.
- **Low shelf** and **high shelf**: `gain` (dB), `freq` (Hz), `q` (default 0.707).
  Magnitude of the standard (RBJ cookbook) analog shelving prototype at `f`.
- **Bell**: `gain` (dB), `freq` (Hz), `q`. Magnitude of the standard analog
  peaking prototype at `f`.

`design(f)` is the sum of the enabled bands. Every band can be switched off
without deleting it. Values must be finite; out-of-range input is clamped or
refused by the field, never applied silently. The number and order of bands is
free (any number of each type).

The default design (what the page starts with) is the "Current (approximated)"
preset below. A read-only line under the band list shows "Level at 20 Hz"
(the sum of the bands at 20 Hz) so the bass level is visible as a single number
even though it is spread over a tilt and a shelf. A knee's sharpness is the
shelf's Q; how far the bass lift reaches is the shelf's frequency and the tilt's
`fLow`.

## Presets

A preset is a saved band list. Loading one replaces the band list with editable
bands. Shipped in Phase 1:

- **Flat**: no bands.
- **Current (approximated)**: the setup the tool had before bands
  (0.7 dB/oct tilt around 1 kHz, 4.5 dB bass shelf, plateau to 40 Hz, blending
  into the tilt by 100 Hz), expressed with standard filters: Tilt 0.7 dB/oct,
  pivot 1000 Hz, `fLow` 50 Hz; Low shelf +1.43 dB at 66.5 Hz, Q 0.90. It stays
  within 0.075 dB of the previous shape everywhere from 20 Hz to 20 kHz and is
  exactly 4.50 dB at 20 Hz. The fit was made by least squares against the previous
  model; the previous shape (a smoothstep crossfade between a plateau and the
  tilt) no longer exists in the tool.
- Approximate literature curves (a Harman-style and a B&K-style in-room target).

Rules for the literature presets:

- They are labelled "approximate" and cite their source in their description;
  each is fitted to the published shape once and stored as bands.
- A preset is shipped only if its source can be cited and its reference points
  can be reproduced within 0.5 dB by the bands; otherwise it is not shipped.
- User-made presets are Phase 2 (saved designs).

## Audyssey behaviour

**HF rolloff.** Audyssey applies one of two fixed HF rolloff shapes on top of
any custom curve, selected by the top-level `enTargetCurveType`:

| MultEQ-X name | `enTargetCurveType` |
|---|---|
| High Frequency Roll Off 1 | 1 |
| High Frequency Roll Off 2 | 2 |

Both shapes are stored as raw (frequency, gain) tables interpolated in
log-frequency, never as fitted formulas. The existing table
(`src/hfKneeData.json`) is Roll Off 2. Roll Off 1 is extracted from a
MultEQ-X Curve Editor screenshot (zero custom curve) using gridline
calibration of both axes; only the resulting table is committed, never the
screenshot. Sanity values: about -1.9 dB at 10 kHz and -7.1 dB at 20 kHz (the
last columns of the drawn line are distorted by its rounded end, so the tail is
extrapolated from the trend before it), flat below about 3 kHz; Roll Off 2 is -3.5 dB and -6.1 dB at the same points.

- A **Rolloff type** selector chooses the shape. On loading a `.ady` it is set
  from that file's `enTargetCurveType`; an unrecognised value falls back to
  Roll Off 2 with a visible notice. The exported file's `enTargetCurveType` is
  the selected type (no longer forced to 2).
- **Cancel HF rolloff** (default on) cancels the shape of the selected type:
  `written(f) = design(f) - rolloff_type(f)`; unticked: `written = design`.
- **Chart** shows what the listener gets: with cancel on, `design`; with cancel
  off, `design + rolloff_type`. No second line for the written curve.

**Sub trim compensation.** A checkbox (`subTrim`). When off, the sub keeps its
input `trimAdjustment` untouched (no shift). Default comes from detection: a
file is treated as already processed when any channel's `customTargetCurvePoints`
sit exactly on this tool's write grid (`frequencyGrid()`, 2161 points). Then the
box starts unticked with a notice explaining why; otherwise ticked. A user can
always override it. The "Contains:" line states whether the sub trim is applied
or skipped. The export filename gets `_no-sub-trim` when it is off (suffix order:
`_no-knee-cancel`, `_no-sub-trim`, `_measured-trim`).

**Measured correction.** Generate reads `enTargetCurveType` from the measured
`.ady` and uses that type's shape for the effective target; types 1 and 2 are
accepted, anything else is refused with a message naming the supported values.
`correction.json` is unchanged (version 1): the stored error is
`measured - target` and does not depend on the rolloff type. The
"channel exceeds 4 dB RMS" warning and everything else stay as they are.

## UI

Step 2 layout: chart; the "Audyssey behaviour" box (rolloff selector, cancel
checkbox, sub trim checkbox); the band list. Each band row: type, its
parameters, on/off checkbox, delete. "Add band" button; "Load preset" dropdown.
The existing slope/shelf controls are replaced by their band equivalents, not
kept alongside. Chart y-range stays -15..15 dB, x 20 Hz-20 kHz.

Phase 2 adds: a handle per band on the chart (drag to change frequency/gain),
compare slots (save the current design as A/B/C and draw them faintly; the
export always uses the active design), and Save/Load design as a small JSON file
(`{ version, name, bands, cancelRolloff }`, so a design can be shared).

## Constants and compatibility

- The default design (the "Current (approximated)" preset) must stay within
  0.1 dB of the previous `designGain` at every point of the write grid
  (regression test against a copy of the old formula kept in the test file), for
  both `cancelHfKnee` settings with Roll Off 2. The old formula is not kept in
  the app.
- Shared write grid, HF-knee cancellation logic, sub trim shift logic,
  measured-correction trims and their maths are unchanged.
- No new dependencies.

## Errors

Invalid band values (non-finite numbers, a tilt with `fLow >= fHigh`, a non-positive
frequency or Q), or an
unrecognised rolloff type in the loaded file are visible messages; nothing is
exported from an invalid design.

## Testing

Test-first, synthetic data only (repo is public).

- Band maths: each type's value at known points (tilt at pivot = 0 and holding
  its value outside `fLow`/`fHigh`, shelf far above/below and half its gain
  (in dB) at its own frequency for Q 0.707, bell at centre = gain), the sum of
  bands, disabled bands ignored.
- Regression: the default design stays within 0.1 dB of the previous formula.
- Rolloff: both tables at knot values and interpolation; type selection from
  `enTargetCurveType`; chart function with cancel on/off; exported
  `enTargetCurveType` follows the selection.
- Sub trim: on/off changes only the sub's `trimAdjustment`; detection true for
  files on this tool's grid, false for raw files; filename suffixes.
- Presets: each shipped preset loads to bands and reproduces its cited reference
  within 0.5 dB.
- Generate: accepts types 1 and 2, uses the matching shape, refuses others.
- Local only (never committed): re-run the stock-measurement error analysis with
  the correct (type-1) shape to check the earlier finding that the error curve
  is the same across targets, and rerun the acceptance check.
- UI: checked manually in the browser.

## Non-goals

- Per-channel design curves; automatic fitting of a curve from a measurement;
  a dedicated non-standard bass shelf type; exact reproduction of literature
  curves; the ~2 kHz
  midrange compensation flag; anything on the measured-correction side beyond
  accepting both rolloff types.

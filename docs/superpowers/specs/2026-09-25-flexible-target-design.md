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

- **Phase 1** (this spec's first implementation plan): band model, new bass
  shelf controls, presets, both HF rolloff types, rolloff shown on the chart,
  sub trim option with detection.
- **Phase 2** (its own plan later): draggable handles on the chart, saved compare
  slots, saving/loading a design as a file.

Both phases are specified here so Phase 1 makes room for Phase 2.

## Curve model

The design curve `design(f)` is built from a list of bands. Default design
(and the regression baseline): bass shelf 4.5 dB (plateau to 40 Hz, rolloff
to 100 Hz, softness 1) + tilt 0.7 dB/oct around 1 kHz.

Band types:

- **Tilt**: `slope` (dB/oct, positive = falling), `pivot` (Hz, default 1000),
  optional range `fLow`/`fHigh` (default 20/20000 = unlimited). The value is
  `slope * log2(pivot / clamp(f, fLow, fHigh))`, i.e. it holds its edge value
  outside the range (continuous, no step).
- **Low shelf** and **high shelf**: `gain` (dB), `freq` (Hz), `q` (default 0.707).
  Magnitude of the standard (RBJ cookbook) analog shelving prototype at `f`.
- **Bell**: `gain` (dB), `freq` (Hz), `q`. Magnitude of the standard analog
  peaking prototype at `f`.
- **Bass shelf** (at most one): the current shelf, generalised. Parameters:
  `gain` (plateau level, dB), `plateauEnd` (Hz, default 40), `rolloffEnd` (Hz,
  default 100), `softness` (0..1, default 1).

Tilt, low/high shelf and bell bands are **additive**: their responses sum into
`rest(f)`.

The **bass shelf is not additive** (deliberate; an additive shelf was rejected
earlier because it stacks with the tilt). It crossfades between its plateau and
`rest(f)`:

```
u(f)  = clamp(log2(f / plateauEnd) / log2(rolloffEnd / plateauEnd), 0, 1)
w(f)  = (1 - softness) * u + softness * smoothstep(u)
design(f) = gain * (1 - w) + rest(f) * w        // with a bass shelf
design(f) = rest(f)                             // without one
```

Below `plateauEnd` the design is the plateau, above `rolloffEnd` it is `rest`.
`softness = 1` is exactly today's shape (smoothstep); `softness = 0` is a straight
crossfade in log-frequency, i.e. sharp knees and a constant dB/octave rolloff
between the two frequencies. `rolloffEnd` (e.g. 100 vs 150 Hz) sets how far up
the shelf reaches. The effective rolloff slope is shown as a read-only value.
Validation: `plateauEnd < rolloffEnd`, both within 20–20000 Hz.

Every band can be switched off without deleting it. Values must be finite;
out-of-range input is clamped or refused by the field, never applied silently.

## Presets

A preset is a saved band list. Loading one replaces the band list with editable
bands. Shipped in Phase 1: **Flat**, **Current** (the default design above), and
approximate literature curves (a Harman-style and a B&K-style in-room target).
Rules:

- Non-trivial presets are labelled "approximate" and cite their source in their
  description; each is fitted to the published shape once and stored as bands.
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
screenshot. Sanity values: about -1.9 dB at 10 kHz and -6.7 dB at 20 kHz, flat
below about 3 kHz; Roll Off 2 is -3.5 dB and -6.1 dB at the same points.

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

- Default design must reproduce today's output to within 1e-9 dB at every
  written point (regression test against the current `designGain`/`writtenGain`),
  for both `cancelHfKnee` settings, with Roll Off 2.
- Shared write grid, HF-knee cancellation logic, sub trim shift logic,
  measured-correction trims and their maths are unchanged.
- No new dependencies.

## Errors

Invalid band values, a bass shelf with `plateauEnd >= rolloffEnd`, or an
unrecognised rolloff type in the loaded file are visible messages; nothing is
exported from an invalid design.

## Testing

Test-first, synthetic data only (repo is public).

- Band maths: each type's value at known points (tilt at pivot = 0, shelf far
  above/below, bell at centre = gain), sum of additive bands, bass shelf blend
  endpoints and softness 0/1.
- Regression: default design equals the current implementation.
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
  more than one bass shelf; exact reproduction of literature curves; the ~2 kHz
  midrange compensation flag; anything on the measured-correction side beyond
  accepting both rolloff types.

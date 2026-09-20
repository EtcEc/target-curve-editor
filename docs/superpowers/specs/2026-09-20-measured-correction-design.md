# Measured Correction — Design

## Purpose

Let the editor correct the systematic error between where Audyssey thinks the
response lands and what an external measurement microphone reads, per speaker,
using REW measurements. A generate step turns REW exports into a small
reusable `correction.json`; the export step applies it as a per-channel trim on
top of the existing shared target curve.

This amends one rule from the original design
(`2026-09-18-target-curve-editor-design.md`): the *design* curve (tilt + shelf)
is still one curve for the whole system, but each measured channel may now get
its own trim added on top.

## Background: what the measurements showed

Measured on a 5-speaker system (30 measurements: 5 speakers x 6 positions) with
a calibrated UMIK-1 pointing up with its 90-degree cal file, i.e. the same
orientation as Audyssey's mic, Dynamic EQ off. Three targets were measured (the
stock calibration, the design curve with the HF knee cancelled, and the design
curve without cancelling). Findings:

- Audyssey delivers what is written into `customTargetCurvePoints` to within
  about 0.05dB above 5kHz. Cancel-on minus cancel-off matches the knee table.
- The AVR **does** apply the knee on top of custom points: default minus
  cancel-off equals the negative of the designed tilt to about 0.1dB. So the
  knee cancellation is correct, and any residual is not caused by it.
- What remains is an error curve `E(f) = measured - target`, **identical across
  all three targets** (spread under 0.3dB). Roughly: -1 to -1.5dB around
  3-4kHz, then +1 to +2.5dB above ~6kHz. It is level-independent, so it can be
  treated as a property of the measurement chain rather than of any one target.
- `E` has the same broad shape on every speaker (correlation 0.90-0.99 between
  1-octave-smoothed curves) with a speaker-dependent size at HF. The most likely
  explanation is Audyssey's own mic differing from the reference mic (its mics
  are not individually calibrated), with smaller contributions from the angular
  responses of the two mics and Audyssey's correction limits. This design does
  not depend on which it is: the trim corrects the sum, and is tied to the mic
  and setup it was measured with.
- The trim estimate is stable in the number of positions averaged. Noise in a
  1-octave-smoothed estimate was about 0.38dB with one position, 0.25dB with
  two, 0.19dB with three. Three positions per speaker is the recommendation.

## Decisions (from design discussion)

- **Workflow:** one optional workflow that produces a reusable correction file.
  It can be regenerated on demand. Both "measure once, reuse" and "measure after
  every calibration" are served by the same file.
- **Known target:** the generate step is given the `.ady` that was measured
  with, and derives each channel's actual target from it. The alternative
  (re-entering design settings by hand) was rejected as too easy to get wrong.
- **Inputs:** one or more REW text files per speaker, averaged by the tool. A
  single pre-averaged file is just the N=1 case.
- **Range:** trim applies above an adjustable cutoff, default 2kHz.
- **Storage approach:** the file stores the measured error curve, and the trim
  is derived at export time. (Rejected: storing finished trims, which would make
  the cutoff non-adjustable and invalidate old files whenever the derivation
  changes.) Same principle as the HF knee: keep the measured data, derive from it.

## Architecture and data flow

Two independent steps joined by `correction.json`.

**Generate** (once, or whenever wanted): inputs are the measured `.ady`, and per
speaker one or more REW text files. Output is a downloaded `correction.json`,
which is also loaded as the active correction so the flow is continuous.

**Apply** (every export): base `.ady`, the existing design settings, optionally a
`correction.json` and a cutoff. Each channel that has an entry in the correction
gets its own curve; all other channels, and the sub, are unchanged.

Modules (each testable alone):

- `rewParse.ts` — parse REW text into `{ freq[], spl[] }`. 2 or 3 columns
  (frequency, SPL, optional phase); tolerates comment lines, blank lines, and
  comma/tab/space separators; ignores extra trailing columns.
- `measuredError.ts` — resample onto the log grid, power-average positions,
  smooth, normalise, and compute `E` against a target.
- `correction.ts` — `CorrectionFile` type, serialise, parse/validate, and
  `trimFromError` (smoothing, clamp, fade).
- `curve.ts` / `ady.ts` — `applyCurveToAdy` gains an optional per-channel trim
  map. With no map, output is unchanged.
- One new UI section (see below).

## Math

### Grid and normalisation

Log grid from 20Hz to 20kHz at 24 points per octave (241 points), shared by all
measured data and the correction file. "Level normalisation" means subtracting
the mean dB value over 500-1500Hz, so only shape is compared and absolute level
never matters.

### Generate: computing E per speaker

1. For each REW file: resample to the grid using 1/6-octave power smoothing.
   Files for one speaker need not share a frequency grid.
2. Power-average the positions (matching REW's RMS average) and normalise.
3. Build the channel's effective target from the measured `.ady`: the channel's
   `customTargetCurvePoints` (parsed from `"{freq, gain}"` strings and
   interpolated in log-frequency onto the grid) **plus the HF knee**. If the
   channel has no custom points the target is the knee alone (a stock
   calibration). Normalise it the same way.
4. `E = measured - target`, stored over the full 20Hz-20kHz.

The measured `.ady` must have `enTargetCurveType` 2; the knee is only valid for
that type, so any other value is refused.

Because `E` is target-independent, generating from a file that already contained
a trim measures the same `E` again. Re-generating never compounds.

### Correction file

```
{
  "version": 1,
  "created": "<ISO timestamp>",
  "label": "<optional free text, e.g. which mic>",
  "freq": [20, ...],                      // shared grid, ascending
  "channels": {
    "<commandId>": { "positions": <n>, "error": [ ... ] }   // same length as freq
  }
}
```

Validation on load: `version` is 1, `freq` is ascending and finite, every
`error` array has the same length as `freq` and is finite, `channels` keys are
strings. Channels present in the file but absent from the base `.ady` are
ignored with a visible notice.

### Deriving the trim (export step)

For a channel with an entry, given cutoff `fc`:

1. `Es` = `error` smoothed with a 1-octave box in dB on the grid.
2. `Ec` = `Es` clamped to +/-3dB.
3. `w(f)` = smoothstep over one octave centred on `fc`: 0 at `fc/sqrt(2)` and
   below, 1 at `fc*sqrt(2)` and above.
4. `trim(f) = -w(f) * Ec(f)`.

The channel's written curve becomes `design(f) - knee(f) + trim(f)` (with the
existing cancel-knee option still deciding whether `knee` is subtracted). Trim
is looked up by log-frequency interpolation between grid points.

The sub keeps the shared curve and its existing trim-shift logic. Channels with
no entry get no trim.

### Constants (fixed, not exposed)

| Constant | Value |
|---|---|
| Grid | 20Hz-20kHz, 24 points/octave |
| Measurement smoothing | 1/6 octave, power |
| Trim smoothing | 1 octave |
| Trim clamp | +/-3dB |
| Fade width | 1 octave, centred on cutoff |
| Normalisation band | 500-1500Hz |
| Default cutoff | 2000Hz (exposed) |

## UI

One new collapsible section, "Measured correction (optional)", under the
existing controls. The chart and existing export flow are unchanged.

**Apply a correction file:** file input for `correction.json`. When loaded, show
the label and date, a Cutoff number field (default 2000Hz), an "Apply
correction" checkbox, and a table of channel, positions measured, and largest
trim at the current cutoff, updating live with the cutoff. Notice for channels
in the file that the base `.ady` lacks.

**Generate a correction file** (nested collapsible):

1. Pick the `.ady` measured with; refuse it if invalid or not type 2.
2. The non-sub channels of that file appear as rows, each with a multi-file
   picker. An empty row is skipped. Rows come from the file, so there is no
   manual file-to-channel assignment.
3. Optional label, then Generate: downloads `correction.json` and loads it as
   the active correction. Generate is disabled while every row is empty.

Each row reports its position count and the RMS of its error over 2-20kHz.

**Export:** unchanged, except the filename gains `_measured-trim` when a
correction is applied (alongside the existing `_no-knee-cancel` suffix).

## Errors

All failures are visible messages; nothing is processed partially.

- REW file not numeric, fewer than 2 columns, non-ascending or non-finite
  frequencies, or not covering 20Hz-20kHz (small tolerance at the ends):
  rejected, naming the file.
- Measured `.ady` invalid or not `enTargetCurveType` 2: refused.
- Correction file invalid: refused with the reason.
- A speaker whose error exceeds 4dB RMS over 2-20kHz: warning (usually means a
  file was put on the wrong row). Not blocking.

## Testing

Test-first, synthetic data only. The repo is public: no personal measurements
are committed, and `correction*.json` is added to `.gitignore`.

- `rewParse`: 2 and 3 columns, comments, tabs/commas/spaces, blank lines, bad
  input.
- `measuredError`: power-averaging known curves; resampling files with different
  grids; recovering a planted error shape from synthetic measured-minus-target
  data; normalisation band.
- `correction`: round-trip; each validation failure; trim sign, zero below the
  fade, clamp at +/-3dB, full effect above the fade, cutoff shifts the fade.
- Export: only channels with an entry change; sub untouched; with no correction
  the output equals today's exactly; cancel-knee off combines correctly.
- Acceptance (local only, never committed): reproduce the error table from the
  measurement session using the real exports.
- UI: checked manually in the browser.

## Non-goals

- An automatic "verify after applying" readout.
- Per-channel design curves (only per-channel trims).
- Sub correction.
- Merging several correction files.
- Any automatic iteration loop.
- Correcting below the cutoff (room modes are position-specific and treated
  differently by Audyssey).

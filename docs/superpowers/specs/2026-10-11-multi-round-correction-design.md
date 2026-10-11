# Multi-Round Correction — Design

## Purpose

The Correct page measures the error against the curve in the file the AVR was
measured with. That is right in round 1, where that file holds the designed
target. From round 2 on, the file holds the round-1 corrected curve, so the page
measures against the corrected curve instead of the real target: an offset that
round 1 already fixed shows up again as error and gets corrected a second time.

This design makes every round measure against the original target and build
on the correction already in place. It amends `2026-09-27-two-workflows-design.md`
(Correct page and Correction settings); anything not mentioned here is
unchanged.

## Model

Audyssey reaches roughly `M = C + R + S`. Here C is the curve in the file, R is
the HF rolloff it adds and S is what it misses (mic positions, room). The aim is
`M = T + R`, where T is the designed target.

- Round 1: `C1 = T`, so `M1 − (T + R) = S`, and the new curve is `T − S`.
- Round 2, with `C1 = T − S` loaded: if S is unchanged, `M2 = T + R` and nothing
  more should change. Today's page computes `M2 − (C1 + R) = S` and subtracts S
  again. That is the bug.

## Maths

Per speaker, on the log grid (`logGrid()`, 24 points per octave). Each curve is
lined up over the octave around 1 kHz, as now.

- T: the target file's curve for the channel.
- C: the measured-with file's curve for the channel.
- R: the rolloff of the files' shared `enTargetCurveType`.
- M: the measurement (1/6-octave smoothed, power averaged across positions).

Steps:

1. **Error against the target:** `E = norm(M) − norm(T + R)`.
2. **Correction so far:** `D = C − T`, where both curves are resampled (log-frequency
   interpolation) and not normalised. It is 0 everywhere when one file is used
   for both.
3. **This round's step:** `step = trim(E)`, the existing `trimFromError` unchanged
   (average over Detail, pin at 1 kHz, scale by Strength, clamp to ±Limit,
   fade in around the cutoff, negate).
4. **New curve:** `T + clamp(D + step, −Limit, +Limit)`.

The Limit caps the total distance from the target across all rounds. If the
Limit is lowered between rounds, a larger correction from an earlier round is
cut back too. When D = 0 (round 1, one file) the outer clamp changes nothing,
because the step is already within ±Limit. So round 1 gives exactly today's
curve.

The new curve is written on the write grid (`frequencyGrid()`). T and C are
resampled there with log-frequency interpolation, and the step is evaluated at
each write-grid frequency (as `applyMeasuredCorrection` does now):
`written(f) = T(f) + clamp(C(f) − T(f) + step(f), ±Limit)`.

## Correct page

**Step 1, Load your files.** It has two drop zones:

- **Your target .ady**: "The file from the Design page." Required.
- **The .ady you measured with**: "The file that was on the AVR for these
  measurements. Leave empty in round 1, when that was the target file itself."
  Optional. It can be removed again (a Clear button).

Both are parsed as now. Either can be loaded first. Replacing one keeps the
other and the measurement files, and the correction is recomputed.

**Checks** run when both files are loaded. A failing check shows a message
under the drop zones, and the measurement step stays unavailable until it is
fixed:

- Both files' `enTargetCurveType` must be 1 or 2 and equal: "The two files use
  different HF rolloff types (N and M). Measure with a file made from this
  target."
- Both files must have the same set of non-sub `commandId`s: "The two files
  have different speakers (only in the target: X; only in the measured-with
  file: Y)."
- The target file must contain at least one curve. This check already exists.

A speaker gets a file input only if it has a curve in both files. Otherwise it
shows "No target curve in this file, so it is left unchanged." (the existing
note) or, when only the measured-with file lacks one, "No curve in the file you
measured with, so it is left unchanged."

**Download.** The measured-with file (or the target file when there is only
one), with the corrected speakers' curves replaced. Other channels' points,
every `trimAdjustment`, `enTargetCurveType` and all other fields are copied
untouched. Filename unchanged: `measuredFilename(<that file's title>, cutoff)`.

**Chart.** For the chosen speaker, all lined up at 1 kHz:

| Line | Style | Shown |
|---|---|---|
| Your target (T + R) | grey `#9aa0ad` | always |
| Measured | amber, as now | always |
| Measured with (C + R) | faint dashed | only with a second file |
| New curve | accent `#5b6cff` | always |

**Table.** The "largest trim" column becomes two columns:

- **This round**: the largest |new − C|.
- **Total**: the largest |new − T|.

These are the same number when only one file is loaded. The positions and
"error RMS 2-20 kHz" columns stay; the RMS is now measured against the target.

**Checklist.** When the second file is loaded, it adds the line "Measured with:
<file name> (correction so far up to X.X dB)", where X.X is the largest |D| over
the corrected speakers. The other lines are unchanged. The settings line still
reads "Detail … · strength … · limit ±… dB". In the hint text, the Limit is
described as capping the total distance from the target.

## Code shape

- `measureCorrection(target, measuredWith, speakers)`: computes E against the
  target. It also checks that each corrected speaker has a curve in both files,
  and returns D (the correction so far, on the log grid) next to E per channel.
  `measuredWith` may be the same object as `target`.
- A new pure function `checkFilePair(target, measuredWith)` returns the rolloff
  type or throws with the messages above.
- `applyMeasuredCorrection(target, measuredWith, trims, limitDb)`: does the
  write-grid formula above and returns a modified copy of `measuredWith`.
- `trimFromError` is unchanged. `summarizeCorrection` and `previewCurves` take the new inputs, and the
  summary carries both "this round" and "total".

## Testing

Test-first, synthetic data only (the repo is public).

- One file for both: output is byte-identical to today's
  `applyMeasuredCorrection` output for the same inputs.
- Round 2 with the bias fixed: a target T and a bias S give round 1's output C1.
  A round-2 measurement equal to T + R then leaves every point of the output
  within 0.05 dB of C1 (the synthetic measurement is smoothed at 1/6 octave, as in the existing pipeline test).
- Half-fixed bias: a round-2 measurement with S/2 remaining moves the output
  by S/2 further, within the limit.
- Limit caps the total: with D already at +2.5 dB and a step of +1 dB at
  Limit 3, the output is T + 3. Lowering the Limit to 2 with no new error
  brings the output to T + 2.
- `checkFilePair` refuses a rolloff-type mismatch and a speaker-set mismatch
  (the message lists the differences), and accepts the same object twice.
- A speaker with a curve in the target but not in the measured-with file gets
  no input and is left unchanged.
- The page-ids check covers the new elements.
- Local acceptance test (opt-in): updated to the new signatures. Measuring
  with the real file as both target and measured-with gives the same result as
  before.
- Browser: round 1 with one file, then round 2 with the downloaded file as
  measured-with, using synthetic measurements that already hit the target
  (expect no change), then ones with half the bias left.

## Non-goals

Remembering the target between visits; detecting automatically which file is
the target; per-round history; changing the Design page.

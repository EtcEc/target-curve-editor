# Two Workflows and Workbench Layout — Design

## Purpose

The single page mixes two unrelated jobs, and it looks more complicated than
either job is:

1. **Design:** load a raw `.ady`, design a target curve, download it.
2. **Correct:** load the `.ady` from job 1 (after measuring with it on the AVR),
   add the REW measurements, download a corrected `.ady`.

Doing job 1, the page shows a correction section you don't need. Doing job 2,
you load one `.ady` in step 1 and then a second `.ady` in a dialog. Worse, job 2
re-derives the curve from whatever bands are active and recomputes the sub
trim. That silently replaces the curve that was in the file and can add the sub
trim twice (it did).

This design splits the tool into two pages, makes the correct page work on the
file's own curve, moves the correction's level anchor to 1 kHz, and gives the
design page a two-column workbench layout with a consistent visual style. It
amends the earlier specs (`2026-09-18`, `2026-09-20`, `2026-09-21`,
`2026-09-25`); anything not mentioned here is unchanged.

## Pages

A Vite multi-page build with three static pages, no framework:

- **`index.html`: start page.** Two cards, each a link with one sentence:
  "Design a target curve: start from the raw .ady from MultEQ-X." and
  "Apply a measured correction: start from a .ady this tool made, plus REW
  measurements taken with it." The live URL keeps working and lands here.
- **`design.html`: design page** (job 1).
- **`correct.html`: correct page** (job 2).

Each page has a small header: the tool name (linking to the start page) and a
link to the other page. Nothing is shared between pages at run time: no state is
carried over, and each page has its own entry script (`src/design/main.ts`,
`src/correct/main.ts`, `src/start/main.ts` if it needs any). The shared logic
modules in `src/` stay shared.

## Design page

Steps: **1 Load your .ady → 2 Design the curve → 3 Download.** Nothing about
measured correction appears on this page.

- **Load:** the existing dropzone, restyled.
- **Design (workbench):**
  - Wide screens (two columns, from about 960 px): left column is the chart
    with its handles and, directly below it, the compare slots A/B/C. It stays
    in view (`position: sticky`) while the right column scrolls. The right
    column holds, top to bottom: the Audyssey behaviour card (rolloff type,
    cancel rolloff, sub trim and their notices), the presets card (preset
    picker, add band, design name, save design, load design, file error), the
    band cards, and the "Level at 20 Hz" line.
  - Narrow screens (one column): a shorter chart (about 220 px) sticks to the
    top of the screen while everything below it scrolls underneath. The compare
    slots follow the chart in the flow (they are not sticky).
- **Download:** the summary as a checklist, one line per fact, then the
  button. It replaces the channel table: the sub trim becomes a checklist line
  ("Sub trim +6.27 dB on SW1", or "Sub trim skipped"). The no-subwoofer warning
  stays. If the loaded file already carries a curve this tool wrote (existing
  `looksAlreadyProcessed`), the existing sub-trim notice also says: "To add a
  measured correction to this file, use the Correct page instead."

Download behaviour, filename and file contents are unchanged except that no
measured trims are ever applied here (`applyCurveToAdy` is called without
trims), so the `_measured-trim` suffix no longer appears on this page.

## Correct page

Steps: **1 Load your .ady → 2 Add measurements → 3 Download.**

One `.ady` does both jobs: it is the file that was loaded on the AVR for the
sweeps (so its curve and rolloff type are the target the measurements are
compared with), and it is the file the download edits. There is no second
`.ady` and no dialog.

- **Load:** dropzone. The file must have rolloff type 1 or 2 (existing
  `checkMeasuredType`). Every non-sub channel that gets a correction must already
  carry a custom curve (non-empty `customTargetCurvePoints`); a channel without
  one is refused with: "Channel X has no target curve. Design one on the Design
  page first."
- **Add measurements:** one row per non-sub channel with a multi-file input for
  its REW exports (as the old dialog), the cutoff field, and a result area:
  per-channel table (channel, positions, error RMS 2-20 kHz, largest trim) and
  the existing RMS warnings. The correction is computed in memory as soon as
  files are picked, and recomputed live when the cutoff changes (the REW files
  are not re-read).
- **Preview chart:** a channel picker and one chart showing, for that channel:
  the file's current curve, the measured response lined up at 1 kHz, and the
  corrected curve. Same axes as the design page chart. No handles.
- **Download:** checklist summary (channels corrected, cutoff, "Curves and sub
  trim otherwise unchanged") and the button. Filename:
  `<title>_measured-<cutoff>Hz.ady` (e.g. `Living_measured-500Hz.ady`), or
  `measured-<cutoff>Hz.ady` without a title.

### What the download changes

For each non-sub channel that has a correction: the new points are the file's
existing curve, resampled onto this tool's write grid (`frequencyGrid()`,
log-frequency interpolation as in `measuredError.writtenCurve`), plus the trim.
For a file already on the write grid this is exactly "add the trim to each
point".

Everything else is copied untouched: other channels' points (verbatim strings),
every `trimAdjustment` (the sub trim is never touched), `enTargetCurveType`,
and all other fields.

Because the file's own curve is the target, repeating the job is an iteration:
load the downloaded file on the AVR, measure again, correct again. Each round
measures what is still off.

### correction.json

Dropped from the UI: the correct page neither loads nor saves correction files
(there is one file and fresh measurements per round, so nothing needs to be
carried between sessions). `correction.ts` keeps only what the correct page uses
(trim building and summary); the file parse/serialise code, its tests, and the
generate dialog are removed.

## Correction maths

Unchanged: 1/6-octave smoothing of REW data, power average across positions,
1-octave box smoothing, clamp to ±3 dB, 1-octave smoothstep fade centred on the
cutoff, negate.

Changed:

- **Level anchor at 1 kHz.** `normalizeLevel` lines curves up by their mean over
  one octave centred on 1 kHz (707-1414 Hz) instead of 500-1500 Hz.
- **Pinned at 1 kHz.** When building the trim, after the 1-octave smoothing and
  before the clamp, the smoothed error's value at 1 kHz (log-frequency
  interpolated) is subtracted from it. So the correction at 1 kHz is 0 (within
  0.01 dB) whenever 1 kHz is fully above the fade (cutoff up to about 700 Hz)
  or fully below it (cutoff from about 1400 Hz, where the trim there is 0
  anyway), and close to 0 in between. Each speaker's curve keeps its existing
  value at 1 kHz. It is
  pinned, not forced to 0 dB: curves that are not 0 dB at 1 kHz (the Harman
  preset is about -0.9 dB there) stay where they are.
- **Cutoff:** default 500 Hz (was 2000); allowed range 100-18000 Hz (was
  200-18000).

Consequence, accepted: with the cutoff below 1 kHz, a broadband level step at
the cutoff (everything above it uniformly louder than the bass) is not
corrected, since measured from 1 kHz it looks like quiet bass, and the bass is
below the cutoff.

## Visual style

Applies to all three pages ("soft elevated cards"):

- Each step and each group of controls is a card: rounded corners (about 12 px),
  a slightly lighter surface than the page, subtle border and shadow, and
  consistent padding and gaps. Headings are small uppercase labels in the accent
  colour.
- One accent colour (blue-violet, about `#5b6cff`) for primary buttons, focus
  rings and badges; secondary buttons are "ghost" (surface-coloured). Colours
  are CSS custom properties in one place.
- Inputs, selects and number fields share one style. Native file inputs are
  hidden behind a styled button plus the chosen file name.
- Band cards: a header row (enable toggle, name with a type badge, delete) and a
  row of labelled fields with fixed widths so fields line up across cards.
- Compare slots: three rows with the same columns (swatch, name, status, Save
  here, Load, Clear); Load and Clear are disabled when the slot is empty, so
  rows line up.
- Chart legend: swatch and name always visible for the lines that are shown;
  numeric values only while the pointer is over the chart (no "--" when idle).
- Dark theme only (as now).

## Constraints

- No new dependencies. Vanilla TypeScript and CSS.
- GitHub Pages deploy keeps working with the relative `base: './'`; all three
  pages are in the build.
- Repo is public: tests use synthetic data only.
- Every element id a page's scripts look up exists in that page's HTML (the
  static id check runs per page).

## Errors

Unchanged messages carry over. New: the correct page's "no target curve"
refusal (above), and the rolloff-type refusal now appears on the correct page's
load step instead of in a dialog.

## Testing

Test-first for all logic; UI checked in the browser.

- Correct-page export (new pure function, e.g.
  `applyMeasuredCorrection(ady, trims)`): adds the trim on the write grid;
  channels without a trim and the sub are byte-identical; every
  `trimAdjustment` and `enTargetCurveType` unchanged; refuses a trimmed channel
  with no custom points; a file on the write grid gets exactly trim added per
  point; an off-grid file is resampled; a second pass with zero error changes
  nothing.
- Anchor and pin: a planted broadband offset is removed by the 1 kHz anchor;
  `|trim(1000)| < 0.01` for cutoffs 100, 300, 500 and 700 Hz with an error that
  is not zero at 1 kHz; with cutoff 2000 the trim below the fade is 0 as
  before.
- Cutoff default 500 and range 100-18000.
- Design page: no trims applied; filename suffixes without `_measured-trim`;
  the download checklist lines (replacing the sentence tests).
- The local acceptance test is updated to the correct-page API.
- Browser: both layouts (wide and narrow), sticky chart, the three pages and
  their links, the correct page end to end with synthetic files, and an
  iteration (download, reload the result, correct again).

## Non-goals

Carrying state between pages; loading or saving correction files; per-channel
design curves; light theme; changing Audyssey's own behaviour or the sub-trim
logic on the design page.

## As built

- The Design page puts "Save or load a design" in its own card below the bands
  card, rather than inside the presets card.
- On the Correct page a speaker whose channel has no custom curve gets no file input and the note "No target curve in this file, so it is left unchanged." instead of an error; a file with no curves at all is refused at load. The download checklist states the fade range (cutoff ÷ √2 to cutoff × √2).

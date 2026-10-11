# Sub Correction — Design

## Purpose

The Correct page only corrects speakers. Its cutoff keeps the correction out of
the bass, which also leaves the crossover region and the sub's own shape
uncorrected. With the speakers set to Small, each speaker's REW sweep is really
the sum of the speaker and the sub, which plays that speaker's bass.

This design sorts the measured errors by who can fix them:
- what all speakers share goes to the sub;
- what is specific to one speaker goes to that speaker.

No crossover model and no separate sub measurement are needed. It amends
`2026-10-11-multi-round-correction-design.md` and
`2026-09-27-two-workflows-design.md`; anything not mentioned here is unchanged.

## Why the split works

**Small changes add up by share.** At one frequency, speaker i's sweep is sub
plus speaker in some split. For small changes, a dB change x_s on the sub's
curve and x_i on the speaker's curve moves the measured sum by about
`w_s·x_s + w_p·x_i`, with `w_s + w_p = 1` when the two sum in phase. Changing
both by the same x moves the sum by exactly x, whatever the split.

**The split.** Let E_i(f) be speaker i's error, measured as now.
- The common part is `c(f) = mean_i E_i(f)`, the dB average over the speakers
  that have measurements.
- The specific part is `r_i = E_i − c`.

**The corrections.**
- Each speaker gets its full correction from E_i, as now.
- The sub gets the correction from c, within its band.

**What is left.** Speaker i's sum then moves by `−w_s·c − w_p·E_i`, which
leaves `w_s·r_i`:
- the common part is corrected wherever the sub plays;
- the specific part is corrected wherever the speaker plays;
- only the speaker-specific part where the sub dominates is left. That part
  cannot be fixed, because one sub serves every speaker.

Far below the crossover every sweep is just the sub, so r_i is close to 0 and
a room mode goes entirely to the sub. The mean is the choice of c that leaves
the least in total. Each round measures what is still off, which covers what
the small-change estimate misses.

**Assumption.** Sub and speakers sum roughly in phase around the crossover (time
alignment is done). If they don't, the crossover-region corrections can work
against each other; the Limit and the rounds bound that.

## Cutoff

- **Range and default.** Range 0-18000 Hz, default 0 (was 100-18000, default
  500).
- **At 0** there is no fade: the correction applies from 20 Hz up.
- **Above 0** it behaves as now: nothing changes below cutoff ÷ √2, and the
  correction fades in over the octave centred on the cutoff.
- **It applies to the sub too.** The sub's step is faded in by the same cutoff
  weight, so a cutoff of 500 Hz leaves the sub unchanged.

## Sub correction

- **Checkbox.** "Correct the sub", on by default, shown in the Correction card.
  Unticked, the sub is left exactly as before, its trim included, and the
  speakers are corrected as now.
- **Which channels.** Every sub channel (commandId starting with `SW`) that has
  a curve in both files gets the same correction, each with its own level
  compensation. A sub without a curve in either file is left unchanged.
- **The sub's step.** `trimFromError(c, …)` with the page's cutoff, Detail,
  Strength and Limit (average, pin at 1 kHz, scale, clamp, fade in at the
  cutoff, negate), multiplied by the band weight below.
- **Band weight.** `1 − smoothstep(log2(f / (2·X)) + 0.5)`: 1 below 2X/√2,
  0.5 at 2X, 0 above 2X·√2. X is the crossover, the highest `customCrossover`
  (parsed as a number) among the corrected speakers in the target file; 80 Hz
  when none has a usable value. For X = 80 the band is full below 113 Hz and
  zero above 226 Hz.
- **Writing the sub's curve.** The same rule as the speakers, on the write
  grid: `T_sub + clamp(C_sub − T_sub + step, ±Limit)`. T_sub comes from the
  target file and C_sub from the measured-with file.
- **Level compensation.** Audyssey shifts a sub's curve so its highest point is
  at 0 dB, so changing the peak changes the sub's level. The written sub keeps
  its level by moving its trim with the peak:
  `trimAdjustment_new = trimAdjustment_measuredWith + (max of new written sub curve − max of measured-with sub curve)`,
  both maxima over the written points, formatted with 6 decimals like the
  Design page. This is the only channel level the Correct page ever changes.
- **Needs speakers.** No speaker measured means no sub correction. The common
  part is based on however many speakers have files; with one speaker it is
  that speaker's error.

## Page

- **Rows.** Speakers keep their REW rows. The sub gets no file input: its
  correction comes from the speaker sweeps.
- **Chart.** When the sub is corrected, the channel picker lists the sub(s)
  after the speakers:
  - Your target: the sub's target;
  - Measured, labelled "Common to all speakers": target + c;
  - Measured with;
  - New curve.
- **Table.** One row per corrected sub:
  - Channel is the sub's id;
  - Positions reads "from N speakers";
  - Error RMS reads "–";
  - This round and Total as for speakers.
- **Checklist.**
  - With the sub corrected, a line "Sub: common correction from N speakers,
    level ±x.xx dB to keep it where it was" (one line per sub), and the last
    line reads "Other channel levels and HF rolloff unchanged".
  - With the sub not corrected, the last line stays "Sub, channel levels and HF
    rolloff unchanged".
  - With a cutoff of 0 the first line reads "Measured correction on FL, FR, …
    over the full range" and the "Unchanged below the fade" line is left out.
- **Hint text.**
  - Cutoff: "0 corrects the full range."
  - Sub: "What all speakers share in the bass goes to the sub, what one speaker
    has on its own goes to that speaker. Its level is kept where it was."

## Testing

Test-first, synthetic data only.

- **Common error.** The same planted bass error on every speaker gives the sub a
  step equal to the speakers' (c = E_i, r_i = 0).
- **Specific errors.** Different errors per speaker give the sub their average,
  and each speaker its own full error.
- **Band.** The sub's step is 0 above 2X·√2 and full below 2X/√2. X is read
  from `customCrossover`, with the 80 Hz fallback for a missing or non-numeric
  value.
- **Cutoff.** Cutoff 0 gives weight 1 everywhere. Cutoff 500 leaves the sub
  unchanged.
- **Level compensation.**
  - A step that raises the sub's peak by 0.5 dB raises its trimAdjustment by
    0.5.
  - A step that leaves the peak alone leaves the trim alone.
  - Unticked, the sub's points and trim are byte-identical to the input.
- **Two rounds.** Measuring the target exactly in round 2 leaves the sub's curve
  and trim unchanged (within 0.05 dB).
- **Single speaker.** The sub follows that speaker's error, and the checklist
  says "from 1 speaker".
- **Download.** The speakers' curves are the same with "Correct the sub" on
  or off. Every trimAdjustment other than a corrected sub's, the rolloff and
  all other fields are untouched.
- **Browser.** A synthetic common bass bump goes to the sub row and chart; a
  per-speaker dip goes to that speaker.

## Non-goals

- Modelling the AVR's crossover slopes.
- A separate sub-alone measurement.
- Correcting speakers that weren't measured. They still hear the sub's change,
  because their bass goes to the sub.
- Changing delays, distances or crossovers.
- Correcting the sub's level, as opposed to its shape.

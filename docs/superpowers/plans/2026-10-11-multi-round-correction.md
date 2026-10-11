# Multi-Round Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Correct page measures every round against the original target and builds on the correction already in the file the AVR was measured with.

**Architecture:**
- The Correct page takes two `.ady` files:
  - the target file;
  - optionally, the file the AVR was measured with.
- When there is no second file, the target file is used for both.
- `measureCorrection` measures the error against the target. It also records `soFar`, the measured-with curve minus the target curve, for each channel.
- The download writes `T + clamp(C − T + step, ±limit)` onto the measured-with file.
- The step comes from `trimFromError`, which is unchanged. With one file the result is byte-identical to today's.

**Tech Stack:** TypeScript (strict), Vite, Vitest, uPlot. No new dependencies.

Spec: `docs/superpowers/specs/2026-10-11-multi-round-correction-design.md`.

## Global Constraints

- **Shell setup:** every shell command runs with Node 20 via nvm. Prefix it with `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null;` and wrap test and build commands in `timeout 120`.
- **Before each commit:** `npx tsc --noEmit -p . && npx vitest run && npm run build` must pass.
- **Commit trailer:** every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, verbatim.
- **No new dependencies.** Tests use synthetic data only; the repo is public, so never commit real `.ady` files or measurements.
- **Maths:**
  - `E = norm(M) − norm(T + R)`
  - `D = C − T`, resampled, not normalised
  - `step = trimFromError(E)`, unchanged
  - `new = T + clamp(D + step, −Limit, +Limit)`
- **Messages, verbatim:**
  - "The two files use different HF rolloff types (N and M). Measure with a file made from this target."
  - "The two files have different speakers (only in the target: X; only in the measured-with file: Y)." Only the parts that apply are listed, joined by "; ".
  - "No curve in the file you measured with, so it is left unchanged."
  - "Channel X has no curve in the file you measured with."
- **Download:** a copy of the measured-with file (or of the target when there is no second file). Only the corrected speakers' curves change. Filename: `measuredFilename(<that file's title>, cutoff)`.

---

### Task 1: Measure against the target and record the correction so far

**Files:**
- Modify: `src/measuredError.ts` (export `writtenCurve`)
- Modify: `src/correction.ts` (add `soFar` to `ChannelCorrection`)
- Modify: `src/generate.ts` (add `checkFilePair`; `measureCorrection` takes two files)
- Modify: `src/generate.test.ts`, `src/correction.test.ts`, `src/correctionPreview.test.ts`, `src/measuredPipeline.test.ts`, `scripts/acceptance.local.test.ts`, `src/correct/main.ts` (call sites only)

**Interfaces:**
- Produces:
  - `writtenCurve(channel: AdyChannel): number[]`, exported from `src/measuredError.ts`.
  - `ChannelCorrection { positions: number; error: number[]; soFar: number[] }`.
  - `checkFilePair(target: AdyFile, measuredWith: AdyFile): RolloffType`.
  - `measureCorrection(target: AdyFile, measuredWith: AdyFile, speakers: readonly SpeakerInput[]): MeasuredResult`.

- [ ] **Step 1: Write the failing tests**

In `src/generate.test.ts`, update every existing call so the measured-with file is the same object as the target:

```bash
uv run --quiet python - <<'EOF'
import re
p='src/generate.test.ts'
s=open(p).read()
s=re.sub(r'measureCorrection\((measuredAdy\(\)|ady), ', r'measureCorrection(\1, \1, ', s)
s=s.replace("import { GenerateError, checkMeasuredType, measureCorrection } from './generate';",
            "import { GenerateError, checkFilePair, checkMeasuredType, measureCorrection } from './generate';")
open(p,'w').write(s)
EOF
grep -n "measureCorrection(" src/generate.test.ts
```

Every call now passes the file twice. Fix any that the grep shows with one argument before the array.

Append to `src/generate.test.ts`:

```ts
/** measuredAdy() with FL's curve raised by `db` above 2 kHz (as a round-1 output might be). */
function shifted(db: number): AdyFile {
  const ady = measuredAdy();
  ady.detectedChannels[0].customTargetCurvePoints = logGrid().map(
    (f) => `{${f.toFixed(3)}, ${(f >= 2000 ? db : 0).toFixed(3)}}`
  );
  return ady;
}

describe('measuring against the target with a separate measured-with file', () => {
  it('records no correction so far when both files are the same', () => {
    const ady = measuredAdy();
    const { correction } = measureCorrection(ady, ady, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    expect(correction.FL.soFar).toHaveLength(logGrid().length);
    expect(correction.FL.soFar.every((v) => v === 0)).toBe(true);
  });

  it('measures the error against the target, not the measured-with curve, and records the difference', () => {
    const { correction } = measureCorrection(measuredAdy(), shifted(1), [
      { commandId: 'FL', files: [file('L1.txt')] },
    ]);
    expect(correction.FL.error[at8k()]).toBeCloseTo(1.5, 1);
    expect(correction.FL.soFar[at8k()]).toBeCloseTo(1, 6);
    expect(correction.FL.soFar[logGrid().findIndex((f) => f >= 500)]).toBeCloseTo(0, 6);
  });

  it('refuses a speaker that has no curve in the measured-with file', () => {
    const withFile = measuredAdy();
    withFile.detectedChannels[0].customTargetCurvePoints = [];
    const run = () => measureCorrection(measuredAdy(), withFile, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    expect(run).toThrow(GenerateError);
    expect(run).toThrow('Channel FL has no curve in the file you measured with.');
  });
});

describe('checkFilePair', () => {
  it('returns the shared rolloff type for the same file or matching files', () => {
    const ady = measuredAdy();
    expect(checkFilePair(ady, ady)).toBe(2);
    expect(checkFilePair(measuredAdy(), shifted(1))).toBe(2);
  });

  it('refuses different rolloff types', () => {
    const other = measuredAdy();
    other.enTargetCurveType = 1;
    expect(() => checkFilePair(measuredAdy(), other)).toThrow(
      'The two files use different HF rolloff types (2 and 1). Measure with a file made from this target.'
    );
  });

  it('refuses an unsupported type in either file', () => {
    const other = measuredAdy();
    other.enTargetCurveType = 0;
    expect(() => checkFilePair(measuredAdy(), other)).toThrow(/enTargetCurveType 0/);
  });

  it('lists the speakers that are only in one of the files, ignoring subs', () => {
    const target = measuredAdy();
    target.detectedChannels.push({ commandId: 'C', customTargetCurvePoints: [], trimAdjustment: '0.0' });
    const other = measuredAdy();
    other.detectedChannels.push({ commandId: 'SW2', customTargetCurvePoints: [], trimAdjustment: '0.0' });
    other.detectedChannels.push({ commandId: 'SLA', customTargetCurvePoints: [], trimAdjustment: '0.0' });
    expect(() => checkFilePair(target, other)).toThrow(
      'The two files have different speakers (only in the target: C; only in the measured-with file: SLA).'
    );
    expect(() => checkFilePair(measuredAdy(), other)).toThrow(
      'The two files have different speakers (only in the measured-with file: SLA).'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `timeout 120 npx vitest run src/generate.test.ts`
Expected: FAIL. `checkFilePair` is not exported, and `soFar` is undefined.

- [ ] **Step 3: Implement**

In `src/measuredError.ts`, export the existing helper by changing `function writtenCurve(` to `export function writtenCurve(`.

In `src/correction.ts`, extend the interface:

```ts
/** One speaker's measured error on the shared log grid (`logGrid()`). */
export interface ChannelCorrection {
  /** How many measurement positions were averaged into `error`. */
  positions: number;
  /** measured - target (dB) at each grid point, lined up at 1 kHz. */
  error: number[];
  /**
   * The correction already in place: the measured-with file's curve minus the
   * target's (dB) at each grid point, not level-normalised. All zeros when the
   * target file was also the file measured with.
   */
  soFar: number[];
}
```

In `src/generate.ts`, change the import to `import { computeError, rmsOver, writtenCurve } from './measuredError';`. Then add `checkFilePair` below `checkMeasuredType`:

```ts
function speakerIds(ady: AdyFile): Set<string> {
  return new Set(ady.detectedChannels.filter((c) => !isSubwooferChannel(c)).map((c) => c.commandId));
}

/**
 * Checks that the target file and the file the AVR was measured with belong
 * together: both of a supported, equal HF rolloff type and with the same
 * speakers (subs are ignored). Returns that rolloff type.
 */
export function checkFilePair(target: AdyFile, measuredWith: AdyFile): RolloffType {
  const type = checkMeasuredType(target);
  if (measuredWith === target) return type;
  const other = checkMeasuredType(measuredWith);
  if (other !== type) {
    throw new GenerateError(
      `The two files use different HF rolloff types (${type} and ${other}). Measure with a file made from this target.`
    );
  }
  const inTarget = speakerIds(target);
  const inOther = speakerIds(measuredWith);
  const onlyTarget = [...inTarget].filter((id) => !inOther.has(id));
  const onlyOther = [...inOther].filter((id) => !inTarget.has(id));
  if (onlyTarget.length > 0 || onlyOther.length > 0) {
    const parts: string[] = [];
    if (onlyTarget.length > 0) parts.push(`only in the target: ${onlyTarget.join(', ')}`);
    if (onlyOther.length > 0) parts.push(`only in the measured-with file: ${onlyOther.join(', ')}`);
    throw new GenerateError(`The two files have different speakers (${parts.join('; ')}).`);
  }
  return type;
}
```

Replace `measureCorrection`'s doc comment, signature and loop body:

```ts
/**
 * Measures each speaker's error from REW exports against the target file's
 * curve (with the HF rolloff on top), and records the correction already in
 * place: the curve in `measuredWith`, the file that was on the AVR for the
 * sweeps, minus the target's. In round 1 both are the same file. Speakers with
 * no files are skipped; a corrected speaker needs a curve in both files.
 */
export function measureCorrection(
  target: AdyFile,
  measuredWith: AdyFile,
  speakers: readonly SpeakerInput[]
): MeasuredResult {
  const rolloffType = checkFilePair(target, measuredWith);
  const active = speakers.filter((s) => s.files.length > 0);
  if (active.length === 0) throw new GenerateError('No measurement files were given.');

  const correction: Correction = {};
  const reports: ChannelReport[] = [];
  const warnings: string[] = [];

  for (const speaker of active) {
    const channel = target.detectedChannels.find((c) => c.commandId === speaker.commandId);
    if (!channel) throw new GenerateError(`The .ady has no channel ${speaker.commandId}.`);
    if (isSubwooferChannel(channel)) {
      throw new GenerateError(`Channel ${speaker.commandId} is a subwoofer and can't be corrected.`);
    }
    if (correction[speaker.commandId]) {
      throw new GenerateError(`Channel ${speaker.commandId} was given twice.`);
    }
    if (channel.customTargetCurvePoints.length === 0) {
      throw new GenerateError(
        `Channel ${speaker.commandId} has no target curve. Design one on the Design page first.`
      );
    }
    const withChannel = measuredWith.detectedChannels.find((c) => c.commandId === speaker.commandId);
    if (!withChannel || withChannel.customTargetCurvePoints.length === 0) {
      throw new GenerateError(`Channel ${speaker.commandId} has no curve in the file you measured with.`);
    }

    const measurements = speaker.files.map((f) => parseRewText(f.text, f.name));
    const error = computeError(measurements, channel, rolloffType);
    const targetCurve = writtenCurve(channel);
    const withCurve = writtenCurve(withChannel);
    const soFar = withCurve.map((v, i) => v - targetCurve[i]);
    const rmsError = rmsOver(error, 2000, 20000);
    const entry: ChannelCorrection = { positions: measurements.length, error, soFar };

    correction[speaker.commandId] = entry;
    reports.push({ commandId: speaker.commandId, positions: measurements.length, rmsError });
    if (rmsError > RMS_WARNING_DB) {
      warnings.push(
        `${speaker.commandId}: error is ${rmsError.toFixed(1)} dB RMS over 2-20 kHz. Check that the right files are on this channel.`
      );
    }
  }

  return { correction, reports, warnings };
}
```

Then update the call sites so everything compiles. These are pure call-site changes with no behaviour change:
- `src/correct/main.ts`: `result = measureCorrection(current, speakers);` becomes `result = measureCorrection(current, current, speakers);`.
- `src/measuredPipeline.test.ts`: `measureCorrection(designed, [` becomes `measureCorrection(designed, designed, [`.
- `scripts/acceptance.local.test.ts`: `measureCorrection(ady, speakers)` becomes `measureCorrection(ady, ady, speakers)`.
- `src/correction.test.ts`: below the `shelf` helper, add `const zeros = freq.map(() => 0);`. Add `soFar: zeros` to every `ChannelCorrection` literal: `{ positions: 3, error: shelf(2), soFar: zeros }`, `{ positions: 2, error: shelf(-1), soFar: zeros }` and `{ positions: 1, error: shelf(2), soFar: zeros }`.
- `src/correctionPreview.test.ts`: below `const error = ...`, add `const soFar = grid.map(() => 0);`. Change each `{ positions: 1, error }` to `{ positions: 1, error, soFar }`.

- [ ] **Step 4: Run the tests and the type check**

Run: `timeout 120 npx tsc --noEmit -p . && timeout 120 npx vitest run`
Expected: tsc clean. All tests pass, with the acceptance test skipped.

- [ ] **Step 5: Commit**

```bash
git add src/measuredError.ts src/correction.ts src/generate.ts src/generate.test.ts src/correction.test.ts src/correctionPreview.test.ts src/measuredPipeline.test.ts scripts/acceptance.local.test.ts src/correct/main.ts
git commit -m "feat: measure against the target file and record the correction so far

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Write the new curve as target plus the capped total

**Files:**
- Modify: `src/correction.ts` (add `clampTotal`)
- Modify: `src/ady.ts` (`applyMeasuredCorrection` takes the target, the measured-with file and the limit)
- Modify: `src/ady.test.ts`, `src/correction.test.ts`, `src/measuredPipeline.test.ts`, `src/correct/main.ts` (call site)
- Modify: `docs/superpowers/specs/2026-10-11-multi-round-correction-design.md` (one testing tolerance)

**Interfaces:**
- Consumes: `measureCorrection(target, measuredWith, speakers)` and `ChannelCorrection.soFar` (Task 1).
- Produces:
  - `clampTotal(soFar: number, step: number, limitDb: number): number`, from `src/correction.ts`.
  - `applyMeasuredCorrection(target: AdyFile, measuredWith: AdyFile, trims: ReadonlyMap<string, TrimFn>, limitDb: number): AdyFile`.

- [ ] **Step 1: Write the failing tests**

In `src/correction.test.ts`, add `clampTotal,` to the import list. Append:

```ts
describe('clampTotal', () => {
  it('adds the step to the correction so far and caps the total at the limit', () => {
    expect(clampTotal(0, 1.25, 3)).toBe(1.25);
    expect(clampTotal(2.5, 1, 3)).toBe(3);
    expect(clampTotal(-2.5, -1, 3)).toBe(-3);
    expect(clampTotal(2.5, 0, 2)).toBe(2);
    expect(clampTotal(2.5, -1, 3)).toBe(1.5);
  });
});
```

In `src/ady.test.ts`, inside `describe('applyMeasuredCorrection', ...)`, rewrite the existing calls to the new signature. A file used for both is passed twice, and the limit is 3:

```bash
uv run --quiet python - <<'EOF'
p='src/ady.test.ts'
s=open(p).read()
s=s.replace("applyMeasuredCorrection(input, new Map([['FL', trim]]))", "applyMeasuredCorrection(input, input, new Map([['FL', trim]]), 3)")
s=s.replace("applyMeasuredCorrection(input, new Map([['FL', trim], ['SW1', trim]]))", "applyMeasuredCorrection(input, input, new Map([['FL', trim], ['SW1', trim]]), 3)")
s=s.replace("applyMeasuredCorrection(ady, new Map([['FL', () => 0.5]]))", "applyMeasuredCorrection(ady, ady, new Map([['FL', () => 0.5]]), 3)")
s=s.replace("const run = () => applyMeasuredCorrection(createSampleAdy(), new Map([['FL', trim]]));",
            "const sample = createSampleAdy();\n    const run = () => applyMeasuredCorrection(sample, sample, new Map([['FL', trim]]), 3);")
s=s.replace("applyMeasuredCorrection(input, new Map([['XX', trim]]))", "applyMeasuredCorrection(input, input, new Map([['XX', trim]]), 3)")
s=s.replace("applyMeasuredCorrection(input, new Map([['FL', () => 0], ['FR', () => 0]]))", "applyMeasuredCorrection(input, input, new Map([['FL', () => 0], ['FR', () => 0]]), 3)")
open(p,'w').write(s)
EOF
grep -n "applyMeasuredCorrection(" src/ady.test.ts
```

Every call in the grep output must now have four arguments.

Then append these tests inside the same `describe('applyMeasuredCorrection', ...)` block, after `'does not mutate the input'`:

```ts
  /** createSampleAdy() with every non-sub channel's curve at a constant `db` on the write grid. */
  function constant(db: number, title = 'Sample') {
    const ady = createSampleAdy();
    ady.title = title;
    ady.detectedChannels[0].customTargetCurvePoints = frequencyGrid().map((f) => `{${f.toFixed(1)}, ${db.toFixed(3)}}`);
    return ady;
  }
  const gainsOf = (ady: ReturnType<typeof constant>) => byId(ady, 'FL').customTargetCurvePoints.map(gainOf);

  it('adds the step to the correction already in the measured-with file', () => {
    const result = applyMeasuredCorrection(constant(0), constant(1), new Map([['FL', () => 0.5]]), 3);
    expect(gainsOf(result).every((g) => g === 1.5)).toBe(true);
  });

  it('caps the total distance from the target at the limit', () => {
    const up = applyMeasuredCorrection(constant(0), constant(2.5), new Map([['FL', () => 1]]), 3);
    expect(gainsOf(up).every((g) => g === 3)).toBe(true);
    const down = applyMeasuredCorrection(constant(0), constant(-2.5), new Map([['FL', () => -1]]), 3);
    expect(gainsOf(down).every((g) => g === -3)).toBe(true);
    const lowered = applyMeasuredCorrection(constant(0), constant(2.5), new Map([['FL', () => 0]]), 2);
    expect(gainsOf(lowered).every((g) => g === 2)).toBe(true);
  });

  it('measures the limit from the target, not from zero', () => {
    const result = applyMeasuredCorrection(constant(-4), constant(-2), new Map([['FL', () => 1]]), 3);
    expect(gainsOf(result).every((g) => g === -1)).toBe(true);
  });

  it('edits a copy of the measured-with file, keeping its other fields', () => {
    const target = constant(0, 'Target');
    const withFile = constant(1, 'Round 1');
    byId(withFile, 'SW1').trimAdjustment = '2.000000';
    const result = applyMeasuredCorrection(target, withFile, new Map([['FL', () => 0]]), 3);
    expect(result.title).toBe('Round 1');
    expect(byId(result, 'SW1')).toEqual(byId(withFile, 'SW1'));
  });

  it('refuses a corrected speaker with no curve in the target or in the measured-with file', () => {
    const noTarget = () => applyMeasuredCorrection(createSampleAdy(), constant(0), new Map([['FL', trim]]), 3);
    expect(noTarget).toThrow(/FL has no target curve/);
    const noWith = () => applyMeasuredCorrection(constant(0), createSampleAdy(), new Map([['FL', trim]]), 3);
    expect(noWith).toThrow('Channel FL has no curve in the file you measured with.');
  });

  it('refuses a limit that is not a positive number', () => {
    const ady = constant(0);
    expect(() => applyMeasuredCorrection(ady, ady, new Map([['FL', trim]]), 0)).toThrow(/Limit/);
    expect(() => applyMeasuredCorrection(ady, ady, new Map([['FL', trim]]), NaN)).toThrow(/Limit/);
  });
```

In `src/measuredPipeline.test.ts`, change the existing call to
`applyMeasuredCorrection(designed, designed, buildChannelTrims(correction, 500), 3)`. Add `import { smoothstep } from './curve';` to the imports. Append:

```ts
describe('multi-round correction', () => {
  const grid = logGrid();
  /** A broad treble error Audyssey keeps missing: 0 below 2 kHz, rising to +1.5 dB at 8 kHz and above. */
  const bias = (f: number) => 1.5 * smoothstep(Math.log2(f / 2000) / 2);
  const designed = applyCurveToAdy(createSampleAdy(), testParams());
  const target = effectiveTarget(channel(designed, 'FL'), 2);
  /** A measurement that lands on the target plus `amount` times the bias. */
  const measured = (amount: number) => [
    { name: 'L.txt', text: synthRewText((f) => 70 + interpLogFreq(grid, target, f) + amount * bias(f)) },
  ];
  const gainAt = (ady: AdyFile, f: number) => {
    const { freqs, gains } = readCurvePoints(channel(ady, 'FL'));
    return gains[freqs.indexOf(f)];
  };
  const round = (measuredWith: AdyFile, amount: number) => {
    const { correction } = measureCorrection(designed, measuredWith, [{ commandId: 'FL', files: measured(amount) }]);
    return applyMeasuredCorrection(designed, measuredWith, buildChannelTrims(correction, 500), 3);
  };

  it('round 1 cuts the bias', () => {
    const round1 = round(designed, 1);
    expect(gainAt(round1, 12000) - gainAt(designed, 12000)).toBeCloseTo(-1.5, 1);
  });

  it('round 2 changes nothing once the measurement hits the target', () => {
    const round1 = round(designed, 1);
    const round2 = round(round1, 0);
    const before = readCurvePoints(channel(round1, 'FL')).gains;
    const after = readCurvePoints(channel(round2, 'FL')).gains;
    let maxDiff = 0;
    for (let i = 0; i < before.length; i++) maxDiff = Math.max(maxDiff, Math.abs(after[i] - before[i]));
    expect(maxDiff).toBeLessThan(0.05);
  });

  it('round 2 adds only what is still off', () => {
    const round1 = round(designed, 1);
    const round2 = round(round1, 0.5);
    expect(gainAt(round2, 12000) - gainAt(round1, 12000)).toBeCloseTo(-0.75, 1);
    expect(gainAt(round2, 12000) - gainAt(designed, 12000)).toBeCloseTo(-2.25, 1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `timeout 120 npx vitest run src/ady.test.ts src/correction.test.ts src/measuredPipeline.test.ts`
Expected: FAIL. `clampTotal` is not exported, `applyMeasuredCorrection` still takes the old arguments, and the round-2 test shows the bias being cut twice.

- [ ] **Step 3: Implement**

In `src/correction.ts`, add after `trimFromError`:

```ts
/**
 * The correction after this round: the correction already in place plus this
 * round's step, capped at +/- the limit so no curve ends up further than that
 * from the target, however many rounds it took.
 */
export function clampTotal(soFar: number, step: number, limitDb: number): number {
  return Math.max(-limitDb, Math.min(limitDb, soFar + step));
}
```

In `src/ady.ts`, add `import { clampTotal } from './correction';` to the imports. Replace `applyMeasuredCorrection` and its doc comment:

```ts
/**
 * Returns a copy of `measuredWith` (the file the AVR was measured with; in
 * round 1 the target file itself) with a measured correction applied. Each
 * non-sub channel that has a trim gets, on the write grid,
 * target + clamp(measuredWith - target + trim, +/- limitDb): the correction
 * already in place plus this round's step, never further than the limit from
 * the target. Both curves are resampled by log-frequency interpolation.
 * Everything else (other channels' points, every trimAdjustment,
 * enTargetCurveType, all other fields) is copied from `measuredWith` as is.
 * Does not mutate the inputs. Throws MeasuredCorrectionError for a corrected
 * channel without a curve in either file, or a limit that is not positive.
 */
export function applyMeasuredCorrection(
  target: AdyFile,
  measuredWith: AdyFile,
  trims: ReadonlyMap<string, TrimFn>,
  limitDb: number
): AdyFile {
  if (!(Number.isFinite(limitDb) && limitDb > 0)) {
    throw new MeasuredCorrectionError(`Limit must be a positive number of dB, got ${limitDb}`);
  }
  const clone = JSON.parse(JSON.stringify(measuredWith)) as AdyFile;
  const grid = frequencyGrid();
  for (const channel of clone.detectedChannels) {
    if (isSubwooferChannel(channel)) continue;
    const trim = trims.get(channel.commandId);
    if (!trim) continue;
    const targetChannel = target.detectedChannels.find((c) => c.commandId === channel.commandId);
    const goal = targetChannel ? readCurvePoints(targetChannel) : { freqs: [], gains: [] };
    if (goal.freqs.length === 0) {
      throw new MeasuredCorrectionError(
        `Channel ${channel.commandId} has no target curve. Design one on the Design page first.`
      );
    }
    const current = readCurvePoints(channel);
    if (current.freqs.length === 0) {
      throw new MeasuredCorrectionError(`Channel ${channel.commandId} has no curve in the file you measured with.`);
    }
    channel.customTargetCurvePoints = grid.map((f) => {
      const t = interpLogFreq(goal.freqs, goal.gains, f);
      const soFar = interpLogFreq(current.freqs, current.gains, f) - t;
      return formatPoint(f, t + clampTotal(soFar, trim(f), limitDb));
    });
  }
  return clone;
}
```

In `src/correct/main.ts`, change the download call to
`applyMeasuredCorrection(ady, ady, buildChannelTrims(result.correction, cutoffHz, trimOptions), trimOptions.limitDb)`.

In the spec's Testing section, replace "leaves every point of the output equal to C1 (within 0.001 dB)" with "leaves every point of the output within 0.05 dB of C1 (the synthetic measurement is smoothed at 1/6 octave, as in the existing pipeline test)".

- [ ] **Step 4: Run the tests and the type check**

Run: `timeout 120 npx tsc --noEmit -p . && timeout 120 npx vitest run`
Expected: tsc clean and all tests pass. The existing `applyMeasuredCorrection` tests still pass unchanged apart from their arguments. That shows that with one file the output is byte-identical to before.

- [ ] **Step 5: Commit**

```bash
git add src/correction.ts src/ady.ts src/ady.test.ts src/correction.test.ts src/measuredPipeline.test.ts src/correct/main.ts docs/superpowers/specs/2026-10-11-multi-round-correction-design.md
git commit -m "feat: write measured corrections as target plus the capped total

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Summary, preview curves, checklist line and chart series

**Files:**
- Modify: `src/correction.ts` (`summarizeCorrection` rows; add `maxSoFar`)
- Modify: `src/correctionPreview.ts` (new curve set)
- Modify: `src/downloadSummary.ts` (measured-with line)
- Modify: `src/correct/previewChart.ts` (four series, dashed "Measured with")
- Modify: `src/correction.test.ts`, `src/correctionPreview.test.ts`, `src/downloadSummary.test.ts`, `src/correct/main.ts` (call sites)

**Interfaces:**
- Consumes: `clampTotal` (Task 2), `ChannelCorrection.soFar` (Task 1).
- Produces:
  - `TrimSummaryRow { commandId: string; positions: number; maxThisRound: number; maxTotal: number }`.
  - `maxSoFar(correction: Correction): number`.
  - `PreviewCurves { freq; target; measured; measuredWith; corrected }` (all `number[]`).
  - `previewCurves(channel, rolloffType, correction, cutoffHz, options = DEFAULT_TRIM_OPTIONS)`, with the same parameters as before. `channel` is the target file's channel.
  - `correctChecklist(channels, cutoffHz, options = DEFAULT_TRIM_OPTIONS, measuredWith?: { name: string; soFarDb: number })`.
  - `updatePreviewChart(chart: uPlot, curves: PreviewCurves | null, showMeasuredWith: boolean): void`.

- [ ] **Step 1: Write the failing tests**

In `src/correction.test.ts`, add `maxSoFar,` to the import list. Replace the two summary tests in `describe('buildChannelTrims / summarizeCorrection', ...)` (from "summarises positions and the largest trim per channel" to "reports a smaller largest trim for a higher cutoff") with:

```ts
  it('summarises positions and the largest change per channel; with nothing so far both columns agree', () => {
    const fl = summarizeCorrection(correction, 4000).find((r) => r.commandId === 'FL')!;
    expect(fl.positions).toBe(3);
    expect(fl.maxThisRound).toBeCloseTo(2, 6);
    expect(fl.maxTotal).toBeCloseTo(2, 6);
  });

  it('reports a smaller largest change for a higher cutoff', () => {
    const low = summarizeCorrection(correction, 4000)[0].maxThisRound;
    const none = summarizeCorrection(correction, 60000)[0].maxThisRound;
    expect(low).toBeGreaterThan(none);
  });

  it('separates this round from the total, capping the total at the limit', () => {
    const soFar = freq.map(() => 2.5);
    const row = summarizeCorrection({ FL: { positions: 1, error: shelf(-1), soFar } }, 4000)[0];
    // above the fade: 2.5 + 1 capped at 3, so this round only adds 0.5
    expect(row.maxTotal).toBeCloseTo(3, 6);
    expect(row.maxThisRound).toBeCloseTo(0.5, 6);
  });
```

In the same file, in the test 'passes the options through buildChannelTrims and summarizeCorrection', change `[0].maxAbsTrim).toBeCloseTo(1, 6)` to `[0].maxThisRound).toBeCloseTo(1, 6)`. Append:

```ts
describe('maxSoFar', () => {
  it('is the largest correction already in place over all channels', () => {
    const soFar = freq.map((f) => (f >= 5000 ? -2.1 : 0.4));
    expect(maxSoFar({ FL: { positions: 1, error: zeros, soFar: zeros }, FR: { positions: 1, error: zeros, soFar } })).toBeCloseTo(2.1, 9);
    expect(maxSoFar({})).toBe(0);
  });
});
```

Replace the whole of `src/correctionPreview.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { trimFromError, DEFAULT_TRIM_OPTIONS } from './correction';
import { previewCurves } from './correctionPreview';
import { effectiveTarget, logGrid } from './measuredError';
import { createSampleAdy } from './fixtures/sampleAdy';

const grid = logGrid();
const channel = () => {
  const c = createSampleAdy().detectedChannels[0];
  c.customTargetCurvePoints = grid.map((f) => `{${f.toFixed(3)}, ${(-0.7 * Math.log2(f / 1000)).toFixed(3)}}`);
  return c;
};
const error = grid.map((f) => (f >= 1500 ? 2 : 0));
const soFar = grid.map(() => 0);

describe('previewCurves', () => {
  it('shows the target, the measurement, the measured-with curve and the new curve on the log grid', () => {
    const curves = previewCurves(channel(), 2, { positions: 1, error, soFar }, 500);
    const target = effectiveTarget(channel(), 2);
    const trim = trimFromError(error, grid, 500);
    expect(curves.freq).toEqual(grid);
    curves.target.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.measured.forEach((v, i) => expect(v).toBeCloseTo(target[i] + error[i], 9));
    curves.measuredWith.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(target[i] + trim(grid[i]), 9));
  });

  it('leaves the target alone below the fade', () => {
    const curves = previewCurves(channel(), 2, { positions: 1, error, soFar }, 4000);
    const i = grid.findIndex((f) => f >= 1000);
    expect(curves.corrected[i]).toBeCloseTo(curves.target[i], 9);
  });

  it('uses the trim options for the new curve', () => {
    const options = { ...DEFAULT_TRIM_OPTIONS, strength: 0.5, limitDb: 0.5 };
    const curves = previewCurves(channel(), 2, { positions: 1, error, soFar }, 500, options);
    const trim = trimFromError(error, grid, 500, options);
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(curves.target[i] + trim(grid[i]), 9));
  });

  it('builds on the correction so far and caps the total at the limit', () => {
    const before = grid.map(() => -2.5);
    const curves = previewCurves(channel(), 2, { positions: 1, error, soFar: before }, 500);
    const i = grid.findIndex((f) => f >= 8000);
    expect(curves.measuredWith[i]).toBeCloseTo(curves.target[i] - 2.5, 9);
    // -2.5 so far plus a -2 step, capped at -3
    expect(curves.corrected[i]).toBeCloseTo(curves.target[i] - 3, 9);
  });
});
```

In `src/downloadSummary.test.ts`, append inside `describe('correctChecklist', ...)`:

```ts
  it('adds a line naming the measured-with file and the correction so far', () => {
    const items = correctChecklist(['FL'], 500, DEFAULT_TRIM_OPTIONS, { name: 'Living_measured-500Hz.ady', soFarDb: 2.14 });
    expect(items[1]).toEqual({
      text: 'Measured with: Living_measured-500Hz.ady (correction so far up to 2.1 dB)',
      on: true,
    });
    expect(items).toHaveLength(5);
  });
```

Make sure `DEFAULT_TRIM_OPTIONS` is imported in that test file. The existing 'shows non-default settings' test already uses it; if it isn't imported, add `import { DEFAULT_TRIM_OPTIONS } from './correction';`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `timeout 120 npx vitest run src/correction.test.ts src/correctionPreview.test.ts src/downloadSummary.test.ts`
Expected: FAIL. `maxThisRound`, `maxSoFar`, `curves.target` and the checklist line don't exist yet.

- [ ] **Step 3: Implement**

In `src/correction.ts`, replace `TrimSummaryRow` and `summarizeCorrection`, and add `maxSoFar`:

```ts
export interface TrimSummaryRow {
  commandId: string;
  positions: number;
  /** Largest change (dB) from the curve the AVR was measured with. */
  maxThisRound: number;
  /** Largest distance (dB) of the new curve from the target. */
  maxTotal: number;
}

export function summarizeCorrection(
  correction: Correction,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): TrimSummaryRow[] {
  const freq = logGrid();
  return Object.entries(correction).map(([commandId, channel]) => {
    const trim = trimFromError(channel.error, freq, cutoffHz, options);
    let maxThisRound = 0;
    let maxTotal = 0;
    freq.forEach((f, i) => {
      const total = clampTotal(channel.soFar[i], trim(f), options.limitDb);
      maxTotal = Math.max(maxTotal, Math.abs(total));
      maxThisRound = Math.max(maxThisRound, Math.abs(total - channel.soFar[i]));
    });
    return { commandId, positions: channel.positions, maxThisRound, maxTotal };
  });
}

/** The largest correction already in place (dB) over every channel. */
export function maxSoFar(correction: Correction): number {
  let max = 0;
  for (const channel of Object.values(correction)) {
    for (const v of channel.soFar) max = Math.max(max, Math.abs(v));
  }
  return max;
}
```

Replace `src/correctionPreview.ts` with:

```ts
import type { AdyChannel } from './ady';
import {
  clampTotal,
  trimFromError,
  type ChannelCorrection,
  type TrimOptions,
  DEFAULT_TRIM_OPTIONS,
} from './correction';
import { effectiveTarget, logGrid } from './measuredError';
import type { RolloffType } from './rolloff';

export interface PreviewCurves {
  freq: number[];
  /** What you are aiming for: the target file's curve plus the HF rolloff. */
  target: number[];
  /** The measured response. */
  measured: number[];
  /** What the AVR was aiming for during the measurement: the target plus the correction so far. */
  measuredWith: number[];
  /** The curve the download writes: the target plus the capped total correction. */
  corrected: number[];
}

/** The Correct page chart's lines for one channel (`channel` is the target file's), all lined up at 1 kHz. */
export function previewCurves(
  channel: AdyChannel,
  rolloffType: RolloffType,
  correction: ChannelCorrection,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): PreviewCurves {
  const freq = logGrid();
  const target = effectiveTarget(channel, rolloffType);
  const trim = trimFromError(correction.error, freq, cutoffHz, options);
  return {
    freq,
    target,
    measured: target.map((v, i) => v + correction.error[i]),
    measuredWith: target.map((v, i) => v + correction.soFar[i]),
    corrected: target.map((v, i) => v + clampTotal(correction.soFar[i], trim(freq[i]), options.limitDb)),
  };
}
```

In `src/downloadSummary.ts`, replace `correctChecklist`:

```ts
/** What the Correct page's download will contain. `measuredWith` is set from round 2 on. */
export function correctChecklist(
  channels: readonly string[],
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS,
  measuredWith?: { name: string; soFarDb: number }
): ChecklistItem[] {
  const lo = Math.round(cutoffHz / Math.SQRT2);
  const hi = Math.round(cutoffHz * Math.SQRT2);
  const items: ChecklistItem[] = [
    {
      text: `Measured correction on ${channels.join(', ')}, fading in from ${lo} Hz to ${hi} Hz (cutoff ${cutoffHz} Hz)`,
      on: true,
    },
  ];
  if (measuredWith) {
    items.push({
      text: `Measured with: ${measuredWith.name} (correction so far up to ${measuredWith.soFarDb.toFixed(1)} dB)`,
      on: true,
    });
  }
  items.push(
    {
      text: `Detail ${formatOctaves(options.detailOctaves)} oct · strength ${Math.round(options.strength * 100)}% · limit ±${options.limitDb} dB`,
      on: true,
    },
    { text: 'Unchanged below the fade; each curve keeps its level at 1 kHz', on: true },
    { text: 'Sub, channel levels and HF rolloff unchanged', on: true }
  );
  return items;
}
```

Replace `src/correct/previewChart.ts` with:

```ts
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { baseChartOptions, chartHeight, fitChart } from '../chart';
import type { PreviewCurves } from '../correctionPreview';
import { logGrid } from '../measuredError';

/** Index of the "Measured with" series (only shown from round 2 on). */
const MEASURED_WITH = 3;

function emptyData(): uPlot.AlignedData {
  const freq = logGrid();
  const empty = freq.map(() => null);
  return [freq, empty, empty, empty, empty] as unknown as uPlot.AlignedData;
}

/** The Correct page chart: target, measurement, measured-with curve and new curve for one channel. */
export function createPreviewChart(container: HTMLElement): uPlot {
  const opts: uPlot.Options = {
    ...baseChartOptions(),
    width: container.clientWidth || 800,
    height: chartHeight(),
    series: [
      {},
      { label: 'Your target', stroke: '#9aa0ad', width: 1.5 },
      { label: 'Measured', stroke: 'rgba(245, 194, 107, 0.9)', width: 1 },
      { label: 'Measured with', stroke: 'rgba(154, 160, 173, 0.6)', width: 1, dash: [6, 4], show: false },
      { label: 'New curve', stroke: '#5b6cff', width: 2 },
    ],
  };
  const chart = new uPlot(opts, emptyData(), container);
  fitChart(chart, container);
  return chart;
}

export function updatePreviewChart(chart: uPlot, curves: PreviewCurves | null, showMeasuredWith: boolean): void {
  if (chart.series[MEASURED_WITH].show !== showMeasuredWith) chart.setSeries(MEASURED_WITH, { show: showMeasuredWith });
  chart.setData(
    curves
      ? ([curves.freq, curves.target, curves.measured, curves.measuredWith, curves.corrected] as unknown as uPlot.AlignedData)
      : emptyData()
  );
}
```

In `src/correct/main.ts`, update the call sites. The full page rework comes in Task 4.
- In `renderTable`, `?.maxAbsTrim ?? 0` becomes `?.maxThisRound ?? 0`.
- Both `updatePreviewChart(chart, ...)` calls get a third argument, `false`.

- [ ] **Step 4: Run the tests, the type check and the build**

Run: `timeout 120 npx tsc --noEmit -p . && timeout 120 npx vitest run && timeout 120 npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/correction.ts src/correctionPreview.ts src/downloadSummary.ts src/correct/previewChart.ts src/correction.test.ts src/correctionPreview.test.ts src/downloadSummary.test.ts src/correct/main.ts
git commit -m "feat: this-round and total summaries, measured-with preview line and checklist entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Correct page with a target file and an optional measured-with file

**Files:**
- Modify: `correct.html` (step 1, table header, limit hint)
- Modify: `src/correct/main.ts` (full replacement below)
- Modify: `README.md` (workflow 2)

**Interfaces:**
- Consumes:
  - `checkFilePair` and `measureCorrection(target, measuredWith, speakers)` (Task 1);
  - `applyMeasuredCorrection(target, measuredWith, trims, limitDb)` (Task 2);
  - `summarizeCorrection` rows `{maxThisRound, maxTotal}`, `maxSoFar`, `previewCurves`, `correctChecklist(…, measuredWith?)` and `updatePreviewChart(chart, curves, showMeasuredWith)` (Task 3).
- Produces: new element ids `with-dropzone`, `with-input`, `with-clear`, `with-error`, `pair-error`. The existing `scripts/page-ids.test.ts` checks them automatically.

- [ ] **Step 1: Update `correct.html`**

Replace the first `<section class="card">…</section>`, the step-1 card, with:

```html
      <section class="card">
        <h2 class="step-title"><span class="step-num">1</span> Load your files</h2>
        <h3 class="card-title">Your target .ady</h3>
        <p class="hint">The file from the Design page. Its curves are what the measurements are compared with.</p>
        <div id="dropzone" class="dropzone">
          <p>Drop a .ady file here, or</p>
          <label class="file-pick">
            <input type="file" id="file-input" accept=".ady" class="visually-hidden" />
            <span class="button">Choose .ady…</span>
            <span class="file-name" data-for="file-input">No file chosen</span>
          </label>
        </div>
        <p id="error-message" class="error" hidden></p>
        <p id="file-info" class="hint" hidden></p>

        <h3 class="card-title">The .ady you measured with</h3>
        <p class="hint">
          The file that was on the AVR for these measurements. Leave empty in round 1, when that was the target file
          itself. From round 2 on, load the file the previous round downloaded: the new correction is added to it.
        </p>
        <div id="with-dropzone" class="dropzone">
          <p>Drop a .ady file here, or</p>
          <label class="file-pick">
            <input type="file" id="with-input" accept=".ady" class="visually-hidden" />
            <span class="button ghost">Choose .ady…</span>
            <span class="file-name" data-for="with-input">No file chosen</span>
          </label>
          <button type="button" id="with-clear" class="ghost small" hidden>Clear</button>
        </div>
        <p id="with-error" class="error" hidden></p>
        <p id="pair-error" class="error" hidden></p>
      </section>
```

Change the measure placeholder text to `2 · Add measurements: load your target .ady first.`

Replace the table header row with:

```html
                  <tr>
                    <th>Channel</th>
                    <th>Positions</th>
                    <th>Error RMS 2–20 kHz (dB)</th>
                    <th>This round (dB)</th>
                    <th>Total (dB)</th>
                  </tr>
```

In the settings hint, replace the sentence "Limit caps every cut and boost." with "Limit caps how far each curve may end up from your target, over all rounds."

- [ ] **Step 2: Replace `src/correct/main.ts`**

```ts
import {
  AdyValidationError,
  applyMeasuredCorrection,
  isSubwooferChannel,
  parseAdy,
  serializeAdy,
  type AdyFile,
} from '../ady';
import {
  DEFAULT_CUTOFF_HZ,
  MAX_CUTOFF_HZ,
  MIN_CUTOFF_HZ,
  buildChannelTrims,
  maxSoFar,
  summarizeCorrection,
  DEFAULT_TRIM_OPTIONS,
  DETAIL_STEPS,
  MAX_LIMIT_DB,
  MIN_LIMIT_DB,
  formatOctaves,
  type TrimOptions,
} from '../correction';
import { previewCurves } from '../correctionPreview';
import { correctChecklist, measuredFilename } from '../downloadSummary';
import {
  checkFilePair,
  checkMeasuredType,
  measureCorrection,
  type MeasuredResult,
  type SpeakerInput,
} from '../generate';
import type { RolloffType } from '../rolloff';
import { renderChecklist } from '../ui/checklist';
import { bindFileNames, showFileName } from '../ui/filePick';
import { createPreviewChart, updatePreviewChart } from './previewChart';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const dropzone = el<HTMLElement>('dropzone');
const fileInput = el<HTMLInputElement>('file-input');
const errorMessage = el<HTMLElement>('error-message');
const fileInfo = el<HTMLElement>('file-info');
const withDropzone = el<HTMLElement>('with-dropzone');
const withInput = el<HTMLInputElement>('with-input');
const withClear = el<HTMLButtonElement>('with-clear');
const withError = el<HTMLElement>('with-error');
const pairError = el<HTMLElement>('pair-error');
const measurePlaceholder = el<HTMLElement>('measure-placeholder');
const measureStep = el<HTMLElement>('measure-step');
const speakerRows = el<HTMLElement>('speaker-rows');
const measureError = el<HTMLElement>('measure-error');
const cutoffInput = el<HTMLInputElement>('cutoff');
const correctionTable = el<HTMLElement>('correction-table');
const correctionBody = correctionTable.querySelector('tbody') as HTMLElement;
const measureWarnings = el<HTMLElement>('measure-warnings');
const detailInput = el<HTMLInputElement>('detail');
const detailValue = el<HTMLElement>('detail-value');
const strengthInput = el<HTMLInputElement>('strength');
const strengthValue = el<HTMLElement>('strength-value');
const limitInput = el<HTMLInputElement>('limit');
const limitValue = el<HTMLElement>('limit-value');
const previewChannel = el<HTMLSelectElement>('preview-channel');
const previewContainer = el<HTMLElement>('preview-chart');
const previewHint = el<HTMLElement>('preview-hint');
const downloadPlaceholder = el<HTMLElement>('download-placeholder');
const downloadSection = el<HTMLElement>('download-section');
const downloadSummary = el<HTMLElement>('download-summary');
const downloadButton = el<HTMLButtonElement>('download');

/** The target file: what the measurements are compared with. */
let target: AdyFile | null = null;
/** The file the AVR was measured with, from round 2 on; null means the target itself. */
let measuredWith: AdyFile | null = null;
let measuredWithName = '';
let rolloffType: RolloffType = 2;
/** True when a target is loaded and it fits the measured-with file. */
let paired = false;
let result: MeasuredResult | null = null;
let cutoffHz = DEFAULT_CUTOFF_HZ;
let chart: ReturnType<typeof createPreviewChart> | null = null;
/** REW files picked per speaker; kept when either .ady is replaced. */
const chosen = new Map<string, File[]>();
/** Each bumped on a new request, so a slow read can't overwrite a newer one. */
let targetLoads = 0;
let withLoads = 0;
let generation = 0;
/** Detail, strength and limit, as set by the sliders. */
const trimOptions: TrimOptions = { ...DEFAULT_TRIM_OPTIONS };

cutoffInput.min = String(MIN_CUTOFF_HZ);
cutoffInput.max = String(MAX_CUTOFF_HZ);
cutoffInput.value = String(DEFAULT_CUTOFF_HZ);

detailInput.min = '0';
detailInput.max = String(DETAIL_STEPS.length - 1);
detailInput.step = '1';
detailInput.value = String(DETAIL_STEPS.indexOf(DEFAULT_TRIM_OPTIONS.detailOctaves));
strengthInput.min = '0';
strengthInput.max = '100';
strengthInput.step = '10';
strengthInput.value = String(DEFAULT_TRIM_OPTIONS.strength * 100);
limitInput.min = String(MIN_LIMIT_DB);
limitInput.max = String(MAX_LIMIT_DB);
limitInput.step = '0.5';
limitInput.value = String(DEFAULT_TRIM_OPTIONS.limitDb);

/** The file the AVR was measured with: the second file, or the target in round 1. */
function base(): AdyFile | null {
  return measuredWith ?? target;
}

/** Reads the three sliders into `trimOptions` and shows their values. */
function readSettings(): void {
  trimOptions.detailOctaves = DETAIL_STEPS[Number(detailInput.value)] ?? DEFAULT_TRIM_OPTIONS.detailOctaves;
  trimOptions.strength = Number(strengthInput.value) / 100;
  trimOptions.limitDb = Number(limitInput.value);
  detailValue.textContent = `${formatOctaves(trimOptions.detailOctaves)} oct`;
  strengthValue.textContent = `${Math.round(trimOptions.strength * 100)}%`;
  limitValue.textContent = `±${trimOptions.limitDb} dB`;
}

/** Shows `message` in `node`, or hides the node when `message` is null. */
function show(node: HTMLElement, message: string | null): void {
  node.textContent = message ?? '';
  node.hidden = message === null;
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

/** Reads and validates a .ady (structure and a supported rolloff type); errors carry a message for the page. */
async function readAdy(file: File): Promise<AdyFile> {
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    throw new Error(`Could not read file: ${(err as Error).message}`);
  }
  try {
    const parsed = parseAdy(text);
    checkMeasuredType(parsed);
    return parsed;
  } catch (err) {
    throw err instanceof AdyValidationError ? new Error(`Not a valid .ady file: ${err.message}`) : err;
  }
}

async function loadTarget(file: File): Promise<void> {
  showFileName('file-input', file.name);
  const mine = ++targetLoads;
  try {
    const parsed = await readAdy(file);
    if (mine !== targetLoads) return;
    const speakers = parsed.detectedChannels.filter((c) => !isSubwooferChannel(c));
    if (!speakers.some((c) => c.customTargetCurvePoints.length > 0)) {
      throw new Error('This file has no target curves. Design one on the Design page first.');
    }
    target = parsed;
    show(errorMessage, null);
    show(fileInfo, `${speakers.length} speakers · High Frequency Roll Off ${parsed.enTargetCurveType}`);
  } catch (err) {
    if (mine !== targetLoads) return;
    target = null;
    show(fileInfo, null);
    show(errorMessage, (err as Error).message);
  }
  refresh();
}

async function loadMeasuredWith(file: File): Promise<void> {
  showFileName('with-input', file.name);
  const mine = ++withLoads;
  try {
    const parsed = await readAdy(file);
    if (mine !== withLoads) return;
    measuredWith = parsed;
    measuredWithName = file.name;
    show(withError, null);
  } catch (err) {
    if (mine !== withLoads) return;
    measuredWith = null;
    measuredWithName = '';
    show(withError, (err as Error).message);
  }
  withClear.hidden = false;
  refresh();
}

function clearMeasuredWith(): void {
  withLoads++;
  measuredWith = null;
  measuredWithName = '';
  withInput.value = '';
  showFileName('with-input', 'No file chosen');
  show(withError, null);
  withClear.hidden = true;
  refresh();
}

/** Re-checks the file pair, rebuilds the speaker rows and measures again with the files already picked. */
function refresh(): void {
  result = null;
  paired = false;
  show(pairError, null);
  const other = base();
  if (target && other) {
    try {
      rolloffType = checkFilePair(target, other);
      paired = true;
    } catch (err) {
      show(pairError, (err as Error).message);
    }
  }
  show(measureError, null);
  buildRows();
  render();
  void recompute();
}

function note(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'hint';
  span.textContent = text;
  return span;
}

function filesLabel(files: readonly File[]): string {
  return files.length === 0 ? 'No files' : files.length === 1 ? files[0].name : `${files.length} files`;
}

/** One row per speaker with a multi-file input for its REW exports. */
function buildRows(): void {
  speakerRows.replaceChildren();
  const other = base();
  if (!target || !other || !paired) return;
  for (const channel of target.detectedChannels) {
    if (isSubwooferChannel(channel)) continue;
    const id = channel.commandId;
    const row = document.createElement('div');
    row.className = 'gen-row';
    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = id;
    row.appendChild(name);

    const withChannel = other.detectedChannels.find((c) => c.commandId === id);
    if (channel.customTargetCurvePoints.length === 0) {
      row.appendChild(note('No target curve in this file, so it is left unchanged.'));
    } else if (!withChannel || withChannel.customTargetCurvePoints.length === 0) {
      row.appendChild(note('No curve in the file you measured with, so it is left unchanged.'));
    } else {
      const pick = document.createElement('label');
      pick.className = 'file-pick';
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.txt,.csv,.tsv,text/plain,text/csv';
      input.className = 'visually-hidden';
      input.dataset.channel = id;
      const choose = document.createElement('span');
      choose.className = 'button ghost small';
      choose.textContent = 'Choose files…';
      const label = document.createElement('span');
      label.className = 'file-name';
      label.textContent = filesLabel(chosen.get(id) ?? []);
      input.addEventListener('change', () => {
        const files = Array.from(input.files ?? []);
        if (files.length === 0) chosen.delete(id);
        else chosen.set(id, files);
        label.textContent = filesLabel(files);
        void recompute();
      });
      pick.append(input, choose, label);
      row.appendChild(pick);
    }
    speakerRows.appendChild(row);
  }
}

/** Reads every picked REW file for the speakers on show and measures the correction. */
async function recompute(): Promise<void> {
  const mine = ++generation;
  const goal = target;
  const other = base();
  if (!goal || !other || !paired) return;
  const speakers: SpeakerInput[] = [];
  try {
    for (const input of speakerRows.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
      const commandId = input.dataset.channel as string;
      const files = chosen.get(commandId) ?? [];
      if (files.length === 0) continue;
      speakers.push({
        commandId,
        files: await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))),
      });
    }
    if (mine !== generation) return;
    result = speakers.length === 0 ? null : measureCorrection(goal, other, speakers);
    show(measureError, null);
  } catch (err) {
    if (mine !== generation) return;
    result = null;
    show(measureError, (err as Error).message);
  }
  render();
}

function renderTable(): void {
  correctionBody.replaceChildren();
  if (!result) {
    correctionTable.hidden = true;
    show(measureWarnings, null);
    return;
  }
  const rows = summarizeCorrection(result.correction, cutoffHz, trimOptions);
  for (const report of result.reports) {
    const row = rows.find((r) => r.commandId === report.commandId);
    const tr = document.createElement('tr');
    tr.append(
      cell(report.commandId),
      cell(String(report.positions)),
      cell(report.rmsError.toFixed(2)),
      cell((row?.maxThisRound ?? 0).toFixed(2)),
      cell((row?.maxTotal ?? 0).toFixed(2))
    );
    correctionBody.appendChild(tr);
  }
  correctionTable.hidden = false;
  show(measureWarnings, result.warnings.length > 0 ? result.warnings.join(' ') : null);
}

function renderPreview(): void {
  if (!target || !paired) return;
  if (!chart) chart = createPreviewChart(previewContainer);
  const ids = result ? Object.keys(result.correction) : [];
  const keep = ids.includes(previewChannel.value) ? previewChannel.value : ids[0];
  previewChannel.replaceChildren(
    ...ids.map((id) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      return option;
    })
  );
  previewChannel.disabled = ids.length === 0;
  previewHint.hidden = ids.length > 0;
  const channel = keep ? target.detectedChannels.find((c) => c.commandId === keep) : undefined;
  if (!result || !keep || !channel) {
    updatePreviewChart(chart, null, measuredWith !== null);
    return;
  }
  previewChannel.value = keep;
  updatePreviewChart(
    chart,
    previewCurves(channel, rolloffType, result.correction[keep], cutoffHz, trimOptions),
    measuredWith !== null
  );
}

function render(): void {
  measureStep.hidden = !paired;
  measurePlaceholder.hidden = paired;
  const ready = paired && result !== null;
  downloadSection.hidden = !ready;
  downloadPlaceholder.hidden = ready;
  renderTable();
  renderPreview();
  if (result) {
    renderChecklist(
      downloadSummary,
      correctChecklist(
        Object.keys(result.correction),
        cutoffHz,
        trimOptions,
        measuredWith ? { name: measuredWithName, soFarDb: maxSoFar(result.correction) } : undefined
      )
    );
  }
}

function cutoffValid(): boolean {
  const value = Number(cutoffInput.value);
  return (
    cutoffInput.value.trim() !== '' && Number.isFinite(value) && value >= MIN_CUTOFF_HZ && value <= MAX_CUTOFF_HZ
  );
}

cutoffInput.addEventListener('input', () => {
  if (!cutoffValid()) return;
  cutoffHz = Math.round(Number(cutoffInput.value));
  render();
});

// a cleared or out-of-range field snaps back to the value in use
cutoffInput.addEventListener('change', () => {
  if (!cutoffValid()) cutoffInput.value = String(cutoffHz);
});

previewChannel.addEventListener('change', () => renderPreview());

for (const input of [detailInput, strengthInput, limitInput]) {
  input.addEventListener('input', () => {
    readSettings();
    render();
  });
}

/** Wires a drop zone and its file input to `load`. */
function bindDropzone(zone: HTMLElement, input: HTMLInputElement, load: (file: File) => Promise<void>): void {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void load(file);
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) void load(file);
  });
}

bindDropzone(dropzone, fileInput, loadTarget);
bindDropzone(withDropzone, withInput, loadMeasuredWith);
withClear.addEventListener('click', clearMeasuredWith);

downloadButton.addEventListener('click', () => {
  const goal = target;
  const other = base();
  if (!goal || !other || !paired || !result) return;
  const corrected = applyMeasuredCorrection(
    goal,
    other,
    buildChannelTrims(result.correction, cutoffHz, trimOptions),
    trimOptions.limitDb
  );
  const url = URL.createObjectURL(new Blob([serializeAdy(corrected)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = measuredFilename(other.title, cutoffHz);
  a.click();
  URL.revokeObjectURL(url);
});

readSettings();
bindFileNames();
render();
```

- [ ] **Step 3: Update `README.md`**

Replace workflow item 2 (from `2. **Apply a measured correction.**` to `again and repeat to refine.`) with:

```markdown
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
```

- [ ] **Step 4: Run the type check, the tests and the build**

Run: `timeout 120 npx tsc --noEmit -p . && timeout 120 npx vitest run && timeout 120 npm run build`
Expected: all pass, including `scripts/page-ids.test.ts` for `correct.html` with the five new ids.

- [ ] **Step 5: Commit**

```bash
git add correct.html src/correct/main.ts README.md
git commit -m "feat: correct page takes the target and the file measured with

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Browser check of two rounds (controller)

Not a code task. The controller runs it after Task 4 with `npm run dev` and claude-in-chrome. It injects synthetic files via DataTransfer, the same way as the earlier browser checks.

- [ ] Round 1: load a synthetic designed target only, with a measurement equal to target plus a broad +1.5 dB treble bias. The table shows "This round" and "Total" equal (about 1.5). The chart has no "Measured with" line. The checklist has no "Measured with" line.
- [ ] Download, then load that file as the measured-with file, keeping the REW file picks.
- [ ] Round 2 with a measurement equal to the target: "This round" is about 0, "Total" is about 1.5, and the dashed line is visible and equals the new curve. The checklist line reads "Measured with: … (correction so far up to 1.5 dB)".
- [ ] Round 2 with half the bias: "This round" is about 0.75.
- [ ] Clear the measured-with file: back to round-1 numbers.
- [ ] Load a measured-with file with a different rolloff type, then one with an extra speaker. The pair messages appear and step 2 hides.

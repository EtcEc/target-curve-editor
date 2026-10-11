# Sub Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Correct page also corrects the sub, using the error all measured speakers share in the bass. It keeps the sub's level by moving its trim with its curve's peak. The cutoff now defaults to 0, meaning full range.

**Architecture:** A new pure module, `src/subCorrection.ts`, does five things:
- computes the common error `c` (the mean of the speakers' errors);
- reads the crossover;
- builds a `SubCorrection` per sub channel;
- turns it into a step (the existing `trimFromError` times a band weight that fades out around 2 × crossover);
- summarises it.

`applyMeasuredCorrection` gets an optional map of sub steps. For each sub, it writes the curve with the same `T + clamp(D + step)` rule as the speakers, and shifts the sub's `trimAdjustment` by the change in the written curve's peak. The preview, the checklist and the page all use these pieces.

**Tech Stack:** TypeScript (strict), Vite, Vitest, uPlot. No new dependencies.

Spec: `docs/superpowers/specs/2026-10-11-sub-correction-design.md`.

## Global Constraints

- **Shell setup:** every shell command runs with Node 20 via nvm. Prefix it with `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null;` and wrap test and build commands in `timeout 120`.
- **Before each commit:** `npx tsc --noEmit -p . && npx vitest run && npm run build` must pass.
- **Commit trailer:** every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, verbatim.
- **No new dependencies.** Tests use synthetic data only; the repo is public, so never commit real `.ady` files or measurements.
- **Cutoff:** range 0-18000 Hz, default 0. At 0 there is no fade (weight 1 from 20 Hz up). Above 0 it behaves as before. It also fades the sub's step.
- **Common error:** `c(f)` is the dB mean of the measured speakers' errors E_i(f). The sub's step is `trimFromError(c, …)` with the page's cutoff, Detail, Strength and Limit, multiplied by the band weight `1 − smoothstep(log2(f / (2·X)) + 0.5)`.
- **Crossover X:** the highest numeric `customCrossover` among the corrected speakers in the target file, or 80 Hz when none has a usable value.
- **Sub curve:** written on the write grid as `T_sub + clamp(C_sub − T_sub + step, ±Limit)`.
- **Sub level:** `trimAdjustment_new = trimAdjustment_measuredWith + (max of new written sub curve − max of measured-with sub curve)`, formatted `toFixed(6)`. It is the only channel level the Correct page changes.
- **"Correct the sub" checkbox:** on by default. Unticked, the sub's points and trim are byte-identical to the input, and the speakers' output is the same either way.
- **Checklist text, verbatim:**
  - "<SW id>: common correction from N speakers, level +x.xx dB to keep it where it was" (singular "speaker" for 1);
  - "Other channel levels and HF rolloff unchanged" when a sub is corrected, otherwise "Sub, channel levels and HF rolloff unchanged";
  - with a cutoff of 0, "Measured correction on FL, FR over the full range" and "Each curve keeps its level at 1 kHz".

---

### Task 1: Cutoff 0 means full range

**Files:**
- Modify: `src/correction.ts` (constants, `trimFromError`)
- Modify: `src/correction.test.ts`, `scripts/acceptance.local.test.ts`

**Interfaces:**
- Produces: `DEFAULT_CUTOFF_HZ = 0` and `MIN_CUTOFF_HZ = 0`. `trimFromError(error, freq, cutoffHz, options)` accepts `cutoffHz >= 0`, and 0 gives weight 1 everywhere.

- [ ] **Step 1: Write the failing tests**

In `src/correction.test.ts`, replace the `describe('cutoff constants', …)` block and the first test of `describe('trimFromError', …)` ('rejects a cutoff that is not a positive finite number') with:

```ts
describe('cutoff constants', () => {
  it('defaults to 0 (full range) and allows 0-18000 Hz', () => {
    expect(DEFAULT_CUTOFF_HZ).toBe(0);
    expect(MIN_CUTOFF_HZ).toBe(0);
    expect(MAX_CUTOFF_HZ).toBe(18000);
  });
});

describe('trimFromError', () => {
  it('rejects a cutoff that is negative or not finite', () => {
    for (const bad of [-1, NaN, Infinity]) {
      expect(() => trimFromError(shelf(1), freq, bad)).toThrow(/cutoff/i);
    }
  });

  it('corrects the full range with a cutoff of 0', () => {
    // 2 dB below 150 Hz, 0 from there up: 0 around the 1 kHz pin, so the trim at 40 Hz is -2
    const bass = freq.map((f) => (f < 150 ? 2 : 0));
    expect(trimFromError(bass, freq, 0)(40)).toBeCloseTo(-2, 6);
    expect(trimFromError(bass, freq, 500)(40)).toBeCloseTo(0, 6);
  });
```

Keep the rest of the `describe('trimFromError', …)` block as it is. The closing `});` that used to follow the replaced test still closes the block.

In `scripts/acceptance.local.test.ts`, the check "zero well below the cutoff" needs a non-zero cutoff:
- change the import `import { DEFAULT_CUTOFF_HZ, buildChannelTrims } from '../src/correction';` to `import { buildChannelTrims } from '../src/correction';`;
- change `buildChannelTrims(result.correction, DEFAULT_CUTOFF_HZ)` to `buildChannelTrims(result.correction, 500)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `timeout 120 npx vitest run src/correction.test.ts`
Expected: FAIL. The constants are still 500 and 100, and a cutoff of 0 throws.

- [ ] **Step 3: Implement**

In `src/correction.ts`:

```ts
/** 0 means no cutoff: the correction applies over the full range. */
export const DEFAULT_CUTOFF_HZ = 0;
export const MIN_CUTOFF_HZ = 0;
export const MAX_CUTOFF_HZ = 18000;
```

In `trimFromError`, replace the cutoff check with:

```ts
  if (!(Number.isFinite(cutoffHz) && cutoffHz >= 0)) {
    throw new Error(`Cutoff must be 0 or a positive finite frequency, got ${cutoffHz}`);
  }
```

Replace the weight line with:

```ts
    const weight = cutoffHz === 0 ? 1 : smoothstep(Math.log2(freq[i] / cutoffHz) / FADE_WIDTH_OCTAVES + 0.5);
```

In its doc comment, change "fade in around the cutoff" to "fade in around the cutoff (no fade for a cutoff of 0)".

- [ ] **Step 4: Run the tests, the type check and the build**

Run: `timeout 120 npx tsc --noEmit -p . && timeout 120 npx vitest run && timeout 120 npm run build`
Expected: all pass. The Correct page now starts at 0. `cutoffInput.min` comes from `MIN_CUTOFF_HZ`, so the page needs no change.

- [ ] **Step 5: Commit**

```bash
git add src/correction.ts src/correction.test.ts scripts/acceptance.local.test.ts
git commit -m "feat: a cutoff of 0 corrects the full range, and is the default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The sub's correction from the speakers' common error

**Files:**
- Create: `src/subCorrection.ts`, `src/subCorrection.test.ts`
- Modify: `src/correction.ts` (add `changeExtent`, used by `summarizeCorrection`)

**Interfaces:**
- Consumes: `trimFromError`, `clampTotal`, `Correction`, `TrimOptions`, `DEFAULT_TRIM_OPTIONS` and `TrimSummaryRow` from `src/correction.ts`; `writtenCurve` and `logGrid` from `src/measuredError.ts`; `smoothstep` and `TrimFn` from `src/curve.ts`; `isSubwooferChannel` and `AdyFile` from `src/ady.ts`.
- Produces:
  - `changeExtent(soFar: readonly number[], step: TrimFn, freq: readonly number[], limitDb: number): { maxThisRound: number; maxTotal: number }`, in `src/correction.ts`.
  - In `src/subCorrection.ts`:
    - `DEFAULT_CROSSOVER_HZ = 80`;
    - `interface SubCorrection { commandId: string; fromSpeakers: number; crossoverHz: number; error: number[]; soFar: number[] }`;
    - `crossoverHz(target: AdyFile, speakerIds: readonly string[]): number`;
    - `subBandWeight(f: number, crossoverHz: number): number`;
    - `commonError(correction: Correction): number[]`;
    - `buildSubCorrections(target: AdyFile, measuredWith: AdyFile, correction: Correction): SubCorrection[]`;
    - `subStep(sub: SubCorrection, cutoffHz: number, options?: TrimOptions): TrimFn`;
    - `summarizeSubs(subs: readonly SubCorrection[], cutoffHz: number, options?: TrimOptions): TrimSummaryRow[]`, where `positions` holds `fromSpeakers`.

- [ ] **Step 1: Write the failing tests**

Create `src/subCorrection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AdyFile } from './ady';
import type { Correction } from './correction';
import { createSampleAdy } from './fixtures/sampleAdy';
import { logGrid } from './measuredError';
import {
  DEFAULT_CROSSOVER_HZ,
  buildSubCorrections,
  commonError,
  crossoverHz,
  subBandWeight,
  subStep,
  summarizeSubs,
} from './subCorrection';

const grid = logGrid();
const curve = (fn: (f: number) => number) => grid.map((f) => `{${f.toFixed(3)}, ${fn(f).toFixed(3)}}`);
const zeros = grid.map(() => 0);
/** 2 dB below 60 Hz, 0 above: 0 around the 1 kHz pin. */
const bassBump = grid.map((f) => (f < 60 ? 2 : 0));

/** FL, FR and SW1, all with a flat curve; FL and FR crossed over at 80 Hz. */
function ady(): AdyFile {
  const a = createSampleAdy();
  a.enTargetCurveType = 2;
  a.detectedChannels[0].customTargetCurvePoints = curve(() => 0);
  a.detectedChannels[0].customCrossover = '80';
  a.detectedChannels[1].customTargetCurvePoints = curve(() => 0);
  a.detectedChannels.push({ commandId: 'FR', customTargetCurvePoints: curve(() => 0), trimAdjustment: '0.000000', customCrossover: '80' });
  return a;
}

describe('crossoverHz', () => {
  it('takes the highest crossover among the corrected speakers', () => {
    const a = ady();
    a.detectedChannels[2].customCrossover = '120';
    expect(crossoverHz(a, ['FL', 'FR'])).toBe(120);
    expect(crossoverHz(a, ['FL'])).toBe(80);
  });

  it('falls back to 80 Hz when no corrected speaker has a usable value', () => {
    const a = ady();
    delete a.detectedChannels[0].customCrossover;
    a.detectedChannels[2].customCrossover = 'N/A';
    expect(crossoverHz(a, ['FL', 'FR'])).toBe(DEFAULT_CROSSOVER_HZ);
    expect(DEFAULT_CROSSOVER_HZ).toBe(80);
  });
});

describe('subBandWeight', () => {
  it('is full below 2X/√2, half at 2X and zero above 2X·√2', () => {
    expect(subBandWeight(40, 80)).toBe(1);
    expect(subBandWeight(160 / Math.SQRT2, 80)).toBeCloseTo(1, 9);
    expect(subBandWeight(160, 80)).toBeCloseTo(0.5, 9);
    expect(subBandWeight(160 * Math.SQRT2, 80)).toBeCloseTo(0, 9);
    expect(subBandWeight(1000, 80)).toBe(0);
  });
});

describe('commonError', () => {
  it('is the mean of the speakers\' errors', () => {
    const correction: Correction = {
      FL: { positions: 3, error: grid.map(() => 1), soFar: zeros },
      FR: { positions: 3, error: grid.map(() => 3), soFar: zeros },
    };
    expect(commonError(correction).every((v) => v === 2)).toBe(true);
  });

  it('is the one speaker\'s error when only one was measured', () => {
    expect(commonError({ FL: { positions: 1, error: bassBump, soFar: zeros } })).toEqual(bassBump);
  });
});

describe('buildSubCorrections', () => {
  const correction: Correction = {
    FL: { positions: 3, error: bassBump, soFar: zeros },
    FR: { positions: 3, error: grid.map((f, i) => bassBump[i] + (f > 200 && f < 400 ? -2 : 0)), soFar: zeros },
  };

  it('gives each sub the speakers\' common error, the crossover and the correction so far', () => {
    const target = ady();
    const withFile = ady();
    withFile.detectedChannels[1].customTargetCurvePoints = curve((f) => (f < 100 ? 1 : 0));
    const [sub, ...rest] = buildSubCorrections(target, withFile, correction);
    expect(rest).toEqual([]);
    expect(sub.commandId).toBe('SW1');
    expect(sub.fromSpeakers).toBe(2);
    expect(sub.crossoverHz).toBe(80);
    expect(sub.error).toEqual(commonError(correction));
    expect(sub.soFar[grid.findIndex((f) => f >= 40)]).toBeCloseTo(1, 6);
    expect(sub.soFar[grid.findIndex((f) => f >= 1000)]).toBeCloseTo(0, 6);
  });

  it('skips a sub without a curve in either file, and needs a measured speaker', () => {
    const noCurve = ady();
    noCurve.detectedChannels[1].customTargetCurvePoints = [];
    expect(buildSubCorrections(noCurve, ady(), correction)).toEqual([]);
    expect(buildSubCorrections(ady(), noCurve, correction)).toEqual([]);
    expect(buildSubCorrections(ady(), ady(), {})).toEqual([]);
  });
});

describe('subStep', () => {
  const [sub] = buildSubCorrections(ady(), ady(), { FL: { positions: 1, error: bassBump, soFar: zeros } });

  it('corrects the common error below the band edge and nothing above it', () => {
    const step = subStep(sub, 0);
    expect(step(30)).toBeCloseTo(-2, 6);
    expect(step(300)).toBeCloseTo(0, 9);
  });

  it('follows the cutoff, strength and limit', () => {
    expect(subStep(sub, 500)(30)).toBeCloseTo(0, 6);
    expect(subStep(sub, 0, { detailOctaves: 1, strength: 0.5, limitDb: 3 })(30)).toBeCloseTo(-1, 6);
    expect(subStep(sub, 0, { detailOctaves: 1, strength: 1, limitDb: 1 })(30)).toBeCloseTo(-1, 6);
  });
});

describe('summarizeSubs', () => {
  it('reports the speakers the sub is based on and its largest change', () => {
    const [sub] = buildSubCorrections(ady(), ady(), { FL: { positions: 4, error: bassBump, soFar: zeros } });
    const [row] = summarizeSubs([sub], 0);
    expect(row.commandId).toBe('SW1');
    expect(row.positions).toBe(1);
    expect(row.maxThisRound).toBeCloseTo(2, 6);
    expect(row.maxTotal).toBeCloseTo(2, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `timeout 120 npx vitest run src/subCorrection.test.ts`
Expected: FAIL, because the module `./subCorrection` does not exist.

- [ ] **Step 3: Implement**

In `src/correction.ts`, add above `summarizeCorrection`:

```ts
/** The largest change from the measured-with curve and the largest distance from the target, for one channel. */
export function changeExtent(
  soFar: readonly number[],
  step: TrimFn,
  freq: readonly number[],
  limitDb: number
): { maxThisRound: number; maxTotal: number } {
  let maxThisRound = 0;
  let maxTotal = 0;
  freq.forEach((f, i) => {
    const total = clampTotal(soFar[i], step(f), limitDb);
    maxTotal = Math.max(maxTotal, Math.abs(total));
    maxThisRound = Math.max(maxThisRound, Math.abs(total - soFar[i]));
  });
  return { maxThisRound, maxTotal };
}
```

Replace the body of `summarizeCorrection`'s map callback with:

```ts
    const trim = trimFromError(channel.error, freq, cutoffHz, options);
    return { commandId, positions: channel.positions, ...changeExtent(channel.soFar, trim, freq, options.limitDb) };
```

Create `src/subCorrection.ts`:

```ts
import { isSubwooferChannel, type AdyFile } from './ady';
import {
  DEFAULT_TRIM_OPTIONS,
  changeExtent,
  trimFromError,
  type Correction,
  type TrimOptions,
  type TrimSummaryRow,
} from './correction';
import { smoothstep, type TrimFn } from './curve';
import { logGrid, writtenCurve } from './measuredError';

/** Used when no corrected speaker has a usable customCrossover (the AVR's usual setting). */
export const DEFAULT_CROSSOVER_HZ = 80;

/**
 * A sub's share of the measured correction: the error every measured speaker
 * has in common (their bass is the sub playing), applied below about twice the
 * crossover.
 */
export interface SubCorrection {
  commandId: string;
  /** How many speakers the common error averages. */
  fromSpeakers: number;
  /** The crossover the sub's band is set from. */
  crossoverHz: number;
  /** The common error c (dB) on the log grid: the mean of the speakers' errors. */
  error: number[];
  /** The sub's curve in the measured-with file minus its target curve (dB) on the log grid. */
  soFar: number[];
}

/** The highest numeric customCrossover among the given speakers in `target`, or 80 Hz. */
export function crossoverHz(target: AdyFile, speakerIds: readonly string[]): number {
  const values = speakerIds
    .map((id) => Number(target.detectedChannels.find((c) => c.commandId === id)?.customCrossover))
    .filter((v) => Number.isFinite(v) && v > 0);
  return values.length > 0 ? Math.max(...values) : DEFAULT_CROSSOVER_HZ;
}

/** 1 below 2X/√2, 0.5 at 2X, 0 above 2X·√2: the sub barely plays above that. */
export function subBandWeight(f: number, crossover: number): number {
  return 1 - smoothstep(Math.log2(f / (2 * crossover)) + 0.5);
}

/** The dB mean of the speakers' errors at each grid point. */
export function commonError(correction: Correction): number[] {
  const errors = Object.values(correction).map((c) => c.error);
  return errors[0].map((_, i) => errors.reduce((sum, e) => sum + e[i], 0) / errors.length);
}

/**
 * One SubCorrection per sub channel with a curve in both files, all sharing
 * the speakers' common error. Empty when no speaker was measured.
 */
export function buildSubCorrections(
  target: AdyFile,
  measuredWith: AdyFile,
  correction: Correction
): SubCorrection[] {
  const speakers = Object.keys(correction);
  if (speakers.length === 0) return [];
  const error = commonError(correction);
  const crossover = crossoverHz(target, speakers);
  const subs: SubCorrection[] = [];
  for (const channel of target.detectedChannels) {
    if (!isSubwooferChannel(channel) || channel.customTargetCurvePoints.length === 0) continue;
    const withChannel = measuredWith.detectedChannels.find((c) => c.commandId === channel.commandId);
    if (!withChannel || withChannel.customTargetCurvePoints.length === 0) continue;
    const targetCurve = writtenCurve(channel);
    const withCurve = writtenCurve(withChannel);
    subs.push({
      commandId: channel.commandId,
      fromSpeakers: speakers.length,
      crossoverHz: crossover,
      error,
      soFar: withCurve.map((v, i) => v - targetCurve[i]),
    });
  }
  return subs;
}

/** This round's step for a sub: the common error's trim, faded out above the sub's band. */
export function subStep(sub: SubCorrection, cutoffHz: number, options: TrimOptions = DEFAULT_TRIM_OPTIONS): TrimFn {
  const trim = trimFromError(sub.error, logGrid(), cutoffHz, options);
  return (f) => trim(f) * subBandWeight(f, sub.crossoverHz);
}

/** Table rows for the subs; `positions` holds how many speakers each is based on. */
export function summarizeSubs(
  subs: readonly SubCorrection[],
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): TrimSummaryRow[] {
  const freq = logGrid();
  return subs.map((sub) => ({
    commandId: sub.commandId,
    positions: sub.fromSpeakers,
    ...changeExtent(sub.soFar, subStep(sub, cutoffHz, options), freq, options.limitDb),
  }));
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `timeout 120 npx tsc --noEmit -p . && timeout 120 npx vitest run`
Expected: tsc clean and all tests pass. The existing `summarizeCorrection` tests still pass after the refactor.

- [ ] **Step 5: Commit**

```bash
git add src/subCorrection.ts src/subCorrection.test.ts src/correction.ts
git commit -m "feat: the sub's correction from the speakers' common error

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Write the sub's curve and keep its level

**Files:**
- Modify: `src/ady.ts` (`applyMeasuredCorrection` takes sub steps; add `subLevelShift`)
- Modify: `src/ady.test.ts`, `src/measuredPipeline.test.ts`

**Interfaces:**
- Consumes: `clampTotal` (`src/correction.ts`); `buildSubCorrections` and `subStep` (Task 2, used in the pipeline test).
- Produces:
  - `applyMeasuredCorrection(target, measuredWith, trims, limitDb, subTrims: ReadonlyMap<string, TrimFn> = new Map()): AdyFile`;
  - `subLevelShift(target: AdyFile, measuredWith: AdyFile, subId: string, trim: TrimFn, limitDb: number): number`, which returns the dB the sub's trim moves by.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('applyMeasuredCorrection', …)` in `src/ady.test.ts`, after the existing tests. The block already defines `byId`, `gainOf`, `constant` and `gainsOf`; `constant(db)` sets only FL's curve.

```ts
  /** constant() with the sub's curve set too. */
  function withSub(db: number, subCurve: (f: number) => number) {
    const ady = constant(db);
    byId(ady, 'SW1').customTargetCurvePoints = frequencyGrid().map((f) => `{${f.toFixed(1)}, ${subCurve(f).toFixed(3)}}`);
    return ady;
  }
  const subGains = (ady: ReturnType<typeof constant>) => byId(ady, 'SW1').customTargetCurvePoints.map(gainOf);

  it('writes the sub with its step and moves its trim by the change in its peak', () => {
    const input = withSub(0, () => 0);
    const result = applyMeasuredCorrection(input, input, new Map(), 3, new Map([['SW1', () => 0.5]]));
    expect(subGains(result).every((g) => g === 0.5)).toBe(true);
    // trim -1.25 plus a 0.5 dB higher peak
    expect(byId(result, 'SW1').trimAdjustment).toBe('-0.750000');
  });

  it('leaves the sub trim alone when the step does not move the peak', () => {
    const input = withSub(0, (f) => (f < 50 ? 4.5 : 0));
    const result = applyMeasuredCorrection(input, input, new Map(), 3, new Map([['SW1', (f: number) => (f > 100 && f < 200 ? -1 : 0)]]));
    expect(byId(result, 'SW1').trimAdjustment).toBe('-1.250000');
    expect(gainOf(byId(result, 'SW1').customTargetCurvePoints.find((p) => p.startsWith('{150.0,'))!)).toBe(-1);
  });

  it('caps the sub at the limit from its target and builds on the measured-with sub', () => {
    const result = applyMeasuredCorrection(withSub(0, () => 0), withSub(0, () => 2.5), new Map(), 3, new Map([['SW1', () => 1]]));
    expect(subGains(result).every((g) => g === 3)).toBe(true);
    // the peak goes from 2.5 to 3
    expect(byId(result, 'SW1').trimAdjustment).toBe('-0.750000');
  });

  it('leaves the sub byte-identical without sub steps, and the speakers the same either way', () => {
    const input = withSub(0, (f) => (f < 50 ? 4.5 : 0));
    const without = applyMeasuredCorrection(input, input, new Map([['FL', () => 0.5]]), 3);
    expect(byId(without, 'SW1')).toEqual(byId(input, 'SW1'));
    const withSteps = applyMeasuredCorrection(input, input, new Map([['FL', () => 0.5]]), 3, new Map([['SW1', () => 1]]));
    expect(byId(withSteps, 'FL')).toEqual(byId(without, 'FL'));
  });

  it('refuses a sub step for a sub with no curve in either file', () => {
    const run = () => applyMeasuredCorrection(constant(0), constant(0), new Map(), 3, new Map([['SW1', () => 1]]));
    expect(run).toThrow(/SW1 has no target curve/);
  });

  it('subLevelShift reports the trim change the download writes', () => {
    const input = withSub(0, () => 0);
    expect(subLevelShift(input, input, 'SW1', () => 0.5, 3)).toBeCloseTo(0.5, 9);
    expect(subLevelShift(input, input, 'SW1', () => -0.25, 3)).toBeCloseTo(-0.25, 9);
  });
```

Change the import line `import { MeasuredCorrectionError, applyMeasuredCorrection } from './ady';` (in the middle of the file) to `import { MeasuredCorrectionError, applyMeasuredCorrection, subLevelShift } from './ady';`.

Append to `src/measuredPipeline.test.ts`. Add `import { buildSubCorrections, subStep } from './subCorrection';` to its imports, and add `type AdyFile` to the `./ady` import if it isn't there:

```ts
describe('sub correction across rounds', () => {
  const grid = logGrid();
  /** FL and FR with the default design, SW1 too; both speakers crossed over at 80 Hz. */
  function designedPair(): AdyFile {
    const ady = applyCurveToAdy(createSampleAdy(), testParams());
    const fl = channel(ady, 'FL');
    fl.customCrossover = '80';
    ady.detectedChannels.push({ ...JSON.parse(JSON.stringify(fl)), commandId: 'FR' });
    return ady;
  }
  const designed = designedPair();
  const target = effectiveTarget(channel(designed, 'FL'), 2);
  /** A dip both speakers share in the bass: the sub's to fix. */
  const dip = (f: number) => -2 * Math.exp(-(Math.log2(f / 40) ** 2) / (2 * 0.5 ** 2));
  const files = (amount: number) => [
    { name: 'm.txt', text: synthRewText((f) => 70 + interpLogFreq(grid, target, f) + amount * dip(f)) },
  ];
  const round = (measuredWith: AdyFile, amount: number) => {
    const { correction } = measureCorrection(designed, measuredWith, [
      { commandId: 'FL', files: files(amount) },
      { commandId: 'FR', files: files(amount) },
    ]);
    const subs = buildSubCorrections(designed, measuredWith, correction);
    return applyMeasuredCorrection(
      designed,
      measuredWith,
      buildChannelTrims(correction, 0),
      3,
      new Map(subs.map((s) => [s.commandId, subStep(s, 0)]))
    );
  };
  const gainAt = (ady: AdyFile, id: string, f: number) => {
    const { freqs, gains } = readCurvePoints(channel(ady, id));
    return gains[freqs.indexOf(f)];
  };

  it('round 1 lifts the sub where every speaker dips, and leaves it alone above its band', () => {
    const round1 = round(designed, 1);
    expect(gainAt(round1, 'SW1', 40) - gainAt(designed, 'SW1', 40)).toBeCloseTo(2, 0);
    expect(gainAt(round1, 'SW1', 1000)).toBe(gainAt(designed, 'SW1', 1000));
  });

  it('round 2 changes neither the sub curve nor its trim once the measurement hits the target', () => {
    const round1 = round(designed, 1);
    const round2 = round(round1, 0);
    const before = readCurvePoints(channel(round1, 'SW1')).gains;
    const after = readCurvePoints(channel(round2, 'SW1')).gains;
    let maxDiff = 0;
    for (let i = 0; i < before.length; i++) maxDiff = Math.max(maxDiff, Math.abs(after[i] - before[i]));
    expect(maxDiff).toBeLessThan(0.05);
    expect(Math.abs(parseFloat(channel(round2, 'SW1').trimAdjustment) - parseFloat(channel(round1, 'SW1').trimAdjustment))).toBeLessThan(0.05);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `timeout 120 npx vitest run src/ady.test.ts src/measuredPipeline.test.ts`
Expected: FAIL. `subLevelShift` is not exported, and the sub steps are ignored.

- [ ] **Step 3: Implement**

In `src/ady.ts`, replace `applyMeasuredCorrection` and its doc comment with the following, keeping the imports. `CurvePoints` is the `{ freqs, gains }` shape returned by `readCurvePoints`; declare it locally as shown.

```ts
type CurvePoints = { freqs: number[]; gains: number[] };

/** The target's and the measured-with file's curve for one channel, or a refusal naming what is missing. */
function curvePair(target: AdyFile, channel: AdyChannel): { goal: CurvePoints; current: CurvePoints } {
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
  return { goal, current };
}

/** target + clamp(measured-with - target + trim, +/- limit) on the write grid, as written points. */
function correctedPoints(goal: CurvePoints, current: CurvePoints, trim: TrimFn, limitDb: number): string[] {
  return frequencyGrid().map((f) => {
    const t = interpLogFreq(goal.freqs, goal.gains, f);
    const soFar = interpLogFreq(current.freqs, current.gains, f) - t;
    return formatPoint(f, t + clampTotal(soFar, trim(f), limitDb));
  });
}

/** Highest gain among written points. */
function peakOf(points: readonly string[]): number {
  return Math.max(...points.map((p) => parseFloat(p.split(',')[1])));
}

function checkLimit(limitDb: number): void {
  if (!(Number.isFinite(limitDb) && limitDb > 0)) {
    throw new MeasuredCorrectionError(`Limit must be a positive number of dB, got ${limitDb}`);
  }
}

/**
 * How much a sub's trimAdjustment moves when its curve gets `trim`: Audyssey
 * shifts a sub's curve so its highest point is at 0 dB, so the trim follows
 * the change in the written curve's peak to keep the sub's level.
 */
export function subLevelShift(
  target: AdyFile,
  measuredWith: AdyFile,
  subId: string,
  trim: TrimFn,
  limitDb: number
): number {
  checkLimit(limitDb);
  const channel = measuredWith.detectedChannels.find((c) => c.commandId === subId);
  if (!channel) throw new MeasuredCorrectionError(`The file you measured with has no channel ${subId}.`);
  const { goal, current } = curvePair(target, channel);
  return peakOf(correctedPoints(goal, current, trim, limitDb)) - Math.max(...current.gains);
}

/**
 * Returns a copy of `measuredWith` (the file the AVR was measured with; in
 * round 1 the target file itself) with a measured correction applied. Each
 * non-sub channel in `trims`, and each sub in `subTrims`, gets on the write
 * grid target + clamp(measuredWith - target + trim, +/- limitDb): the
 * correction already in place plus this round's step, never further than the
 * limit from the target. A corrected sub's trimAdjustment moves by the change
 * in its curve's peak (see subLevelShift), so its level stays where it was.
 * Everything else is copied from `measuredWith` as is. Does not mutate the
 * inputs. Throws MeasuredCorrectionError for a corrected channel without a
 * curve in either file, or a limit that is not positive.
 */
export function applyMeasuredCorrection(
  target: AdyFile,
  measuredWith: AdyFile,
  trims: ReadonlyMap<string, TrimFn>,
  limitDb: number,
  subTrims: ReadonlyMap<string, TrimFn> = new Map()
): AdyFile {
  checkLimit(limitDb);
  const clone = JSON.parse(JSON.stringify(measuredWith)) as AdyFile;
  for (const channel of clone.detectedChannels) {
    const sub = isSubwooferChannel(channel);
    const trim = (sub ? subTrims : trims).get(channel.commandId);
    if (!trim) continue;
    const { goal, current } = curvePair(target, channel);
    const points = correctedPoints(goal, current, trim, limitDb);
    if (sub) {
      const shift = peakOf(points) - Math.max(...current.gains);
      channel.trimAdjustment = (parseFloat(channel.trimAdjustment) + shift).toFixed(6);
    }
    channel.customTargetCurvePoints = points;
  }
  return clone;
}
```

`AdyChannel` and `TrimFn` are already imported or declared in `src/ady.ts`; check the imports and add `type TrimFn` from `./curve` if it is missing. Remove the now-unused local `grid` variable if tsc reports it.

- [ ] **Step 4: Run the tests and the type check**

Run: `timeout 120 npx tsc --noEmit -p . && timeout 120 npx vitest run`
Expected: all pass. That includes the existing `applyMeasuredCorrection` tests: one of them passes `SW1` in the speaker `trims` map and expects the sub untouched, and that still holds because subs only read `subTrims`.

- [ ] **Step 5: Commit**

```bash
git add src/ady.ts src/ady.test.ts src/measuredPipeline.test.ts
git commit -m "feat: write the sub's corrected curve and keep its level

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sub preview curves and checklist lines

**Files:**
- Modify: `src/correctionPreview.ts` (shared helper; add `subPreviewCurves`)
- Modify: `src/downloadSummary.ts` (`correctChecklist`: sub lines, cutoff 0)
- Modify: `src/correctionPreview.test.ts`, `src/downloadSummary.test.ts`
- Modify: `docs/superpowers/specs/2026-10-11-sub-correction-design.md` (two wording notes)

**Interfaces:**
- Consumes: `SubCorrection` and `subStep` (Task 2); `clampTotal` and `trimFromError` (`src/correction.ts`).
- Produces:
  - `subPreviewCurves(channel: AdyChannel, rolloffType: RolloffType, sub: SubCorrection, cutoffHz: number, options?: TrimOptions): PreviewCurves`;
  - `interface SubChecklistEntry { commandId: string; fromSpeakers: number; levelDb: number }`;
  - `correctChecklist(channels, cutoffHz, options = DEFAULT_TRIM_OPTIONS, measuredWith?, subs: readonly SubChecklistEntry[] = [])`.

- [ ] **Step 1: Write the failing tests**

Append to `src/correctionPreview.test.ts`. Add `import { buildSubCorrections, subStep } from './subCorrection';`, `import { clampTotal } from './correction';` and `import { subPreviewCurves } from './correctionPreview';` to its imports, merging with the existing import lines:

```ts
describe('subPreviewCurves', () => {
  it('shows the sub\'s target, the common error, the measured-with curve and the new sub curve', () => {
    const ady = createSampleAdy();
    ady.enTargetCurveType = 2;
    ady.detectedChannels[0].customTargetCurvePoints = channel().customTargetCurvePoints;
    ady.detectedChannels[1].customTargetCurvePoints = channel().customTargetCurvePoints;
    const bass = grid.map((f) => (f < 60 ? 2 : 0));
    const [sub] = buildSubCorrections(ady, ady, { FL: { positions: 1, error: bass, soFar } });
    const subChannel = ady.detectedChannels[1];
    const curves = subPreviewCurves(subChannel, 2, sub, 0);
    const target = effectiveTarget(subChannel, 2);
    const step = subStep(sub, 0);
    curves.target.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.measured.forEach((v, i) => expect(v).toBeCloseTo(target[i] + bass[i], 9));
    curves.measuredWith.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(target[i] + clampTotal(0, step(grid[i]), 3), 9));
  });
});
```

Append inside `describe('correctChecklist', …)` in `src/downloadSummary.test.ts`:

```ts
  it('says "over the full range" and keeps the 1 kHz note with a cutoff of 0', () => {
    expect(correctChecklist(['FL', 'FR'], 0).map((i) => i.text)).toEqual([
      'Measured correction on FL, FR over the full range',
      'Detail 1 oct · strength 100% · limit ±3 dB',
      'Each curve keeps its level at 1 kHz',
      'Sub, channel levels and HF rolloff unchanged',
    ]);
  });

  it('adds a line per corrected sub and says the other levels are unchanged', () => {
    const items = correctChecklist(['FL', 'FR'], 0, DEFAULT_TRIM_OPTIONS, undefined, [
      { commandId: 'SW1', fromSpeakers: 5, levelDb: 0.4 },
      { commandId: 'SW2', fromSpeakers: 1, levelDb: -0.123 },
    ]);
    expect(items.map((i) => i.text)).toEqual([
      'Measured correction on FL, FR over the full range',
      'SW1: common correction from 5 speakers, level +0.40 dB to keep it where it was',
      'SW2: common correction from 1 speaker, level -0.12 dB to keep it where it was',
      'Detail 1 oct · strength 100% · limit ±3 dB',
      'Each curve keeps its level at 1 kHz',
      'Other channel levels and HF rolloff unchanged',
    ]);
  });

  it('shows a level change that rounds to zero as +0.00', () => {
    const items = correctChecklist(['FL'], 0, DEFAULT_TRIM_OPTIONS, undefined, [
      { commandId: 'SW1', fromSpeakers: 1, levelDb: -0.001 },
    ]);
    expect(items[1].text).toBe('SW1: common correction from 1 speaker, level +0.00 dB to keep it where it was');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `timeout 120 npx vitest run src/correctionPreview.test.ts src/downloadSummary.test.ts`
Expected: FAIL. `subPreviewCurves` doesn't exist, and the checklist has no full-range or sub lines.

- [ ] **Step 3: Implement**

In `src/correctionPreview.ts`, add `import { subStep, type SubCorrection } from './subCorrection';` and `import type { TrimFn } from './curve';`. Replace `previewCurves` with a shared helper plus the two public functions:

```ts
function curvesFor(
  channel: AdyChannel,
  rolloffType: RolloffType,
  error: readonly number[],
  soFar: readonly number[],
  step: TrimFn,
  limitDb: number
): PreviewCurves {
  const freq = logGrid();
  const target = effectiveTarget(channel, rolloffType);
  return {
    freq,
    target,
    measured: target.map((v, i) => v + error[i]),
    measuredWith: target.map((v, i) => v + soFar[i]),
    corrected: target.map((v, i) => v + clampTotal(soFar[i], step(freq[i]), limitDb)),
  };
}

/** The Correct page chart's lines for one speaker (`channel` is the target file's), all lined up at 1 kHz. */
export function previewCurves(
  channel: AdyChannel,
  rolloffType: RolloffType,
  correction: ChannelCorrection,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): PreviewCurves {
  const step = trimFromError(correction.error, logGrid(), cutoffHz, options);
  return curvesFor(channel, rolloffType, correction.error, correction.soFar, step, options.limitDb);
}

/** The same lines for a sub: "measured" is its target plus the speakers' common error. */
export function subPreviewCurves(
  channel: AdyChannel,
  rolloffType: RolloffType,
  sub: SubCorrection,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): PreviewCurves {
  return curvesFor(channel, rolloffType, sub.error, sub.soFar, subStep(sub, cutoffHz, options), options.limitDb);
}
```

In `src/downloadSummary.ts`, add above `correctChecklist`:

```ts
/** One corrected sub, for the Correct page's checklist. */
export interface SubChecklistEntry {
  commandId: string;
  fromSpeakers: number;
  /** How much its trimAdjustment moves (dB). */
  levelDb: number;
}

/** "+0.40", "-0.12"; anything that rounds to zero is "+0.00". */
function signedLevel(db: number): string {
  const rounded = Math.abs(db) < 0.005 ? 0 : db;
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(2)}`;
}
```

Replace `correctChecklist`:

```ts
/**
 * What the Correct page's download will contain. `measuredWith` is set from
 * round 2 on; `subs` lists the subs that get the common correction.
 */
export function correctChecklist(
  channels: readonly string[],
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS,
  measuredWith?: { name: string; soFarDb: number },
  subs: readonly SubChecklistEntry[] = []
): ChecklistItem[] {
  const fade =
    cutoffHz === 0
      ? 'over the full range'
      : `fading in from ${Math.round(cutoffHz / Math.SQRT2)} Hz to ${Math.round(cutoffHz * Math.SQRT2)} Hz (cutoff ${cutoffHz} Hz)`;
  const items: ChecklistItem[] = [
    { text: `Measured correction on ${channels.join(', ')}${cutoffHz === 0 ? ' ' : ', '}${fade}`, on: true },
  ];
  if (measuredWith) {
    items.push({
      text: `Measured with: ${measuredWith.name} (correction so far up to ${measuredWith.soFarDb.toFixed(1)} dB)`,
      on: true,
    });
  }
  for (const sub of subs) {
    const speakers = `${sub.fromSpeakers} speaker${sub.fromSpeakers === 1 ? '' : 's'}`;
    items.push({
      text: `${sub.commandId}: common correction from ${speakers}, level ${signedLevel(sub.levelDb)} dB to keep it where it was`,
      on: true,
    });
  }
  items.push(
    {
      text: `Detail ${formatOctaves(options.detailOctaves)} oct · strength ${Math.round(options.strength * 100)}% · limit ±${options.limitDb} dB`,
      on: true,
    },
    {
      text: cutoffHz === 0 ? 'Each curve keeps its level at 1 kHz' : 'Unchanged below the fade; each curve keeps its level at 1 kHz',
      on: true,
    },
    {
      text: subs.length > 0 ? 'Other channel levels and HF rolloff unchanged' : 'Sub, channel levels and HF rolloff unchanged',
      on: true,
    }
  );
  return items;
}
```

For a non-zero cutoff, the first line keeps today's text exactly: "Measured correction on FL, FR, C, fading in from 354 Hz to 707 Hz (cutoff 500 Hz)". The existing test checks that.

In the spec `docs/superpowers/specs/2026-10-11-sub-correction-design.md`, append:

```markdown

## Notes from planning

- The sub's checklist line starts with its channel id ("SW1: common correction from 5 speakers, …") rather than "Sub:", so two subs can be told apart.
- With a cutoff of 0 the "Unchanged below the fade; …" line becomes "Each curve keeps its level at 1 kHz" instead of being left out, so the 1 kHz note stays.
```

- [ ] **Step 4: Run the tests and the type check**

Run: `timeout 120 npx tsc --noEmit -p . && timeout 120 npx vitest run`
Expected: all pass, including the existing `correctChecklist` and `previewCurves` tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/correctionPreview.ts src/downloadSummary.ts src/correctionPreview.test.ts src/downloadSummary.test.ts docs/superpowers/specs/2026-10-11-sub-correction-design.md
git commit -m "feat: sub preview curves and checklist lines; full-range wording for cutoff 0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Correct page: the sub option, table row, chart and download

**Files:**
- Modify: `correct.html` (checkbox and hints)
- Modify: `src/correct/main.ts`
- Modify: `src/correct/previewChart.ts` (rename the "Measured" legend label for a sub)
- Modify: `README.md`

**Interfaces:**
- Consumes:
  - `buildSubCorrections`, `subStep`, `summarizeSubs` and `SubCorrection` (Task 2);
  - `applyMeasuredCorrection(…, subTrims)` and `subLevelShift` (Task 3);
  - `subPreviewCurves` and `correctChecklist(…, subs)` (Task 4).
- Produces: element id `correct-sub`, checked by `scripts/page-ids.test.ts`, and `setMeasuredLabel(chart: uPlot, text: string): void` in `src/correct/previewChart.ts`.

- [ ] **Step 1: Update `correct.html`**

In the Correction card, replace the cutoff hint paragraph:

```html
              <p class="hint">
                Nothing changes below cutoff ÷ √2; the correction fades in over the octave centred on the cutoff.
                Each curve keeps its level at 1 kHz.
              </p>
```

with:

```html
              <p class="hint">
                0 corrects the full range. Above 0, nothing changes below cutoff ÷ √2 and the correction fades in over
                the octave centred on the cutoff. Each curve keeps its level at 1 kHz.
              </p>
              <label class="check"><input type="checkbox" id="correct-sub" checked /> Correct the sub</label>
              <p class="hint">
                What all speakers share in the bass goes to the sub, what one speaker has on its own goes to that
                speaker. Its level is kept where it was.
              </p>
```

- [ ] **Step 2: Add the legend relabel to `src/correct/previewChart.ts`**

Append:

```ts
/** Index of the "Measured" series. */
const MEASURED = 2;

/** Renames the "Measured" line, e.g. to "Common to all speakers" while a sub is shown. */
export function setMeasuredLabel(chart: uPlot, text: string): void {
  const label = chart.root.querySelectorAll('.u-legend .u-series')[MEASURED]?.querySelector('.u-label');
  if (label && label.textContent !== text) label.textContent = text;
}
```

- [ ] **Step 3: Update `src/correct/main.ts`**

Imports. Add `subLevelShift` to the `'../ady'` import. Add `subPreviewCurves` to the `'../correctionPreview'` import. Add `setMeasuredLabel` to the `'./previewChart'` import. Add:

```ts
import { buildSubCorrections, subStep, summarizeSubs, type SubCorrection } from '../subCorrection';
```

Next to the other element lookups, add:

```ts
const correctSubInput = el<HTMLInputElement>('correct-sub');
```

After `function base()`, add:

```ts
/** The subs getting the speakers' common correction (none when unticked or nothing is measured yet). */
function currentSubs(): SubCorrection[] {
  const goal = target;
  const other = base();
  if (!result || !goal || !other || !paired || !correctSubInput.checked) return [];
  return buildSubCorrections(goal, other, result.correction);
}

function subTrims(subs: readonly SubCorrection[]): Map<string, ReturnType<typeof subStep>> {
  return new Map(subs.map((s) => [s.commandId, subStep(s, cutoffHz, trimOptions)]));
}
```

Replace `renderTable` with:

```ts
function renderTable(subs: readonly SubCorrection[]): void {
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
  for (const row of summarizeSubs(subs, cutoffHz, trimOptions)) {
    const tr = document.createElement('tr');
    tr.append(
      cell(row.commandId),
      cell(`from ${row.positions} speaker${row.positions === 1 ? '' : 's'}`),
      cell('–'),
      cell(row.maxThisRound.toFixed(2)),
      cell(row.maxTotal.toFixed(2))
    );
    correctionBody.appendChild(tr);
  }
  correctionTable.hidden = false;
  show(measureWarnings, result.warnings.length > 0 ? result.warnings.join(' ') : null);
}
```

Replace `renderPreview` with:

```ts
function renderPreview(subs: readonly SubCorrection[]): void {
  if (!target || !paired) return;
  if (!chart) chart = createPreviewChart(previewContainer);
  const ids = result ? [...Object.keys(result.correction), ...subs.map((s) => s.commandId)] : [];
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
  const sub = subs.find((s) => s.commandId === keep);
  setMeasuredLabel(chart, sub ? 'Common to all speakers' : 'Measured');
  if (!result || !keep || !channel) {
    updatePreviewChart(chart, null, measuredWith !== null);
    return;
  }
  previewChannel.value = keep;
  const curves = sub
    ? subPreviewCurves(channel, rolloffType, sub, cutoffHz, trimOptions)
    : previewCurves(channel, rolloffType, result.correction[keep], cutoffHz, trimOptions);
  updatePreviewChart(chart, curves, measuredWith !== null);
}
```

In `render()`, replace the calls `renderTable();` and `renderPreview();` and the `if (result) { renderChecklist(…) }` block with:

```ts
  const subs = currentSubs();
  renderTable(subs);
  renderPreview(subs);
  const goal = target;
  const other = base();
  if (result && goal && other) {
    const trims = subTrims(subs);
    renderChecklist(
      downloadSummary,
      correctChecklist(
        Object.keys(result.correction),
        cutoffHz,
        trimOptions,
        measuredWith ? { name: measuredWithName, soFarDb: maxSoFar(result.correction) } : undefined,
        subs.map((s) => ({
          commandId: s.commandId,
          fromSpeakers: s.fromSpeakers,
          levelDb: subLevelShift(goal, other, s.commandId, trims.get(s.commandId)!, trimOptions.limitDb),
        }))
      )
    );
  }
```

Change the preview-channel listener to `previewChannel.addEventListener('change', () => renderPreview(currentSubs()));`.

Add next to it: `correctSubInput.addEventListener('change', () => render());`.

In the download handler, change the `applyMeasuredCorrection(…)` call to:

```ts
  const corrected = applyMeasuredCorrection(
    goal,
    other,
    buildChannelTrims(result.correction, cutoffHz, trimOptions),
    trimOptions.limitDb,
    subTrims(currentSubs())
  );
```

- [ ] **Step 4: Update `README.md`**

At the end of workflow item 2 (after "…repeat with it as the measured-with file."), add:

```markdown
   The sub is corrected too ("Correct the sub", on by default): what every
   measured speaker has in common in the bass is the sub playing, so that part
   goes to the sub, below about twice the crossover, while each speaker gets
   its own error. The sub's trim moves with its curve's peak so its level stays
   where it was. The cutoff defaults to 0 (full range); set it higher to leave
   everything below it alone.
```

- [ ] **Step 5: Run the type check, the tests and the build**

Run: `timeout 120 npx tsc --noEmit -p . && timeout 120 npx vitest run && timeout 120 npm run build`
Expected: all pass, including `scripts/page-ids.test.ts` with `correct-sub`.

- [ ] **Step 6: Commit**

```bash
git add correct.html src/correct/main.ts src/correct/previewChart.ts README.md
git commit -m "feat: correct the sub from the speakers' common error on the Correct page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Browser check (controller)

Not a code task. The controller runs it with `npm run dev` and claude-in-chrome. It injects synthetic files via DataTransfer and builds them in the page with `await import('/src/…')`, as in the earlier checks.

- [ ] **Common bass dip:** a designed target with FL and FR, both measured as target plus the same −2 dB dip around 40 Hz, cutoff 0. The table has an SW1 row "from 2 speakers" with This round ≈ 2. The chart for SW1 shows "Common to all speakers" with the dip. The checklist has the SW1 line and "Other channel levels and HF rolloff unchanged". In the download, the SW1 curve is about +2 at 40 Hz, and its trim moves by the change in its peak.
- [ ] **Dip on one speaker:** a dip at 250 Hz on FL only goes to FL's curve. SW1 gets nothing from it, because 250 Hz is above the sub's band (zero above 226 Hz for an 80 Hz crossover).
- [ ] **Unticked:** with "Correct the sub" unticked, the SW1 row and checklist line disappear, and the downloaded SW1 is byte-identical to the input.
- [ ] **Cutoff 500:** SW1's This round is 0.00.

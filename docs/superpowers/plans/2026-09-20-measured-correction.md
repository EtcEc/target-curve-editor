# Measured Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the editor generate a reusable `correction.json` from REW measurements and apply it as a per-channel trim above an adjustable cutoff, correcting the systematic error between Audyssey's target and an external microphone's reading.

**Architecture:** Small pure modules (`logInterp`, `rewParse`, `measuredError`, `correction`, `generate`) do all the math and file handling and are unit-tested with synthetic data. The existing `applyCurveToAdy` gains an optional per-channel trim map. One new UI module wires a collapsible "Measured correction" section into the existing page. Design spec: `docs/superpowers/specs/2026-09-20-measured-correction-design.md` (read it for the reasoning; this plan is self-contained for the code).

**Tech Stack:** TypeScript, Vite, Vitest. No new dependencies.

## Global Constraints

- Static, fully client-side. Nothing is uploaded anywhere.
- Repo is public: **no personal measurements, `.ady` files or `correction*.json` are ever committed.** Test fixtures are synthetic only. `correction*.json` and `*.ady` are already in `.gitignore`.
- Shared log grid: `20 * 2^(i/24)` for `i = 0 … 239`, plus a final point at exactly `20000` Hz (241 points, ascending).
- Measurement smoothing: 1/6 octave, power (energy) average. Averaging across positions: power average.
- Level normalisation: subtract the mean dB value over 500–1500 Hz (inclusive) on the grid.
- Trim derivation, in this order: 1-octave box smoothing of the error (25 grid points, ±12, edge-replicated), clamp to ±3 dB, multiply by a smoothstep fade that is 0 at `cutoff/√2` and below and 1 at `cutoff·√2` and above, negate. Default cutoff 2000 Hz. Only the cutoff is exposed.
- The measured `.ady` must have `enTargetCurveType` 2; any other value is refused.
- A channel's effective target = its `customTargetCurvePoints` (interpolated in log-frequency onto the grid; all zeros if it has none) + the HF knee (`hfKneeGain`), level-normalised.
- The sub (`commandId` starting `SW`) and channels without a correction entry never get a trim. The design curve stays one shared curve.
- Export filename gains `_measured-trim` (after any `_no-knee-cancel`) only when a trim actually changes at least one channel.
- REW files must cover 20 Hz–20 kHz (first point ≤ 20.5 Hz, last point ≥ 19500 Hz). Errors are visible messages that name the file; nothing is processed partially. A speaker whose error exceeds 4 dB RMS over 2–20 kHz gets a non-blocking warning.
- Correction file: `{ version: 1, created, label, freq[], channels: { <commandId>: { positions, error[] } } }`.
- TDD: write the failing test first, watch it fail, then implement. The existing 49 tests must keep passing.
- Environment: the default Node on PATH is too old. **Before any `npm`/`npx`/`node` command run:**
  ```bash
  export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
  ```
- Every commit message ends with the line `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (use a heredoc as shown in each task).

---

### Task 1: Log-frequency interpolation helper

**Files:**
- Create: `src/logInterp.ts`
- Test: `src/logInterp.test.ts`

**Interfaces:**
- Produces: `interpLogFreq(xs: readonly number[], ys: readonly number[], x: number): number` — linear interpolation of `ys` against `log10(xs)`, clamped to the end values outside the range. `xs` ascending and positive. Throws on empty data. Consumed by Tasks 3, 4, 6.

- [ ] **Step 1: Write the failing test**

Create `src/logInterp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpLogFreq } from './logInterp';

describe('interpLogFreq', () => {
  const xs = [100, 1000, 10000];
  const ys = [0, 10, 40];

  it('returns the exact value at a node', () => {
    expect(interpLogFreq(xs, ys, 1000)).toBeCloseTo(10, 9);
  });

  it('interpolates linearly in log-frequency between nodes', () => {
    expect(interpLogFreq(xs, ys, Math.sqrt(100 * 1000))).toBeCloseTo(5, 6);
    expect(interpLogFreq(xs, ys, Math.sqrt(1000 * 10000))).toBeCloseTo(25, 6);
  });

  it('clamps to the end values outside the range', () => {
    expect(interpLogFreq(xs, ys, 10)).toBe(0);
    expect(interpLogFreq(xs, ys, 50000)).toBe(40);
  });

  it('works with a single point', () => {
    expect(interpLogFreq([500], [7], 123)).toBe(7);
    expect(interpLogFreq([500], [7], 800)).toBe(7);
  });

  it('throws on empty data', () => {
    expect(() => interpLogFreq([], [], 100)).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/logInterp.test.ts`
Expected: FAIL — cannot resolve `./logInterp`.

- [ ] **Step 3: Implement**

Create `src/logInterp.ts`:

```ts
/**
 * Linear interpolation of `ys` against log10(`xs`), clamped to the end values
 * outside the range. `xs` must be ascending and positive.
 */
export function interpLogFreq(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0) throw new Error('interpLogFreq: no data points');
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (Math.log10(x) - Math.log10(xs[lo])) / (Math.log10(xs[hi]) - Math.log10(xs[lo]));
  return ys[lo] + t * (ys[hi] - ys[lo]);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/logInterp.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/logInterp.ts src/logInterp.test.ts
git commit -m "$(cat <<'EOF'
feat: add log-frequency interpolation helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: REW text parser

**Files:**
- Create: `src/rewParse.ts`
- Test: `src/rewParse.test.ts`

**Interfaces:**
- Produces:
  - `interface RewMeasurement { freq: number[]; spl: number[] }`
  - `class RewParseError extends Error`
  - `parseRewText(text: string, name?: string): RewMeasurement` — `name` (default `'file'`) is used in error messages. Consumed by Tasks 3, 8, 9.

- [ ] **Step 1: Write the failing tests**

Create `src/rewParse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseRewText, RewParseError } from './rewParse';

const BAND = '10, 60\n1000, 70\n20000, 65';

describe('parseRewText', () => {
  it('parses two comma-separated columns', () => {
    const m = parseRewText(BAND);
    expect(m.freq).toEqual([10, 1000, 20000]);
    expect(m.spl).toEqual([60, 70, 65]);
  });

  it('ignores a third (phase) column and extra columns', () => {
    const m = parseRewText('10, 60, -161.4\n1000, 70, 12.5\n20000, 65, -88.4');
    expect(m.freq).toEqual([10, 1000, 20000]);
    expect(m.spl).toEqual([60, 70, 65]);
  });

  it('accepts tabs, spaces and CRLF line endings', () => {
    expect(parseRewText('10\t60\n1000\t70\n20000\t65').spl).toEqual([60, 70, 65]);
    expect(parseRewText('10 60\n1000 70\n20000 65').spl).toEqual([60, 70, 65]);
    expect(parseRewText(BAND.replace(/\n/g, '\r\n')).spl).toEqual([60, 70, 65]);
  });

  it('skips comment lines, header lines and blank lines', () => {
    const text =
      '* Measurement data\n* Freq(Hz), SPL(dB), Phase(degrees)\nFreq(Hz), SPL(dB)\n\n10, 60\n\n1000, 70\n20000, 65\n';
    const m = parseRewText(text);
    expect(m.freq).toEqual([10, 1000, 20000]);
  });

  it('drops non-positive frequencies', () => {
    const m = parseRewText('0, 55\n10, 60\n1000, 70\n20000, 65');
    expect(m.freq).toEqual([10, 1000, 20000]);
  });

  it('parses exponent notation', () => {
    const m = parseRewText('1e1, 6e1\n1e3, 7e1\n2e4, 6.5e1');
    expect(m.freq).toEqual([10, 1000, 20000]);
    expect(m.spl).toEqual([60, 70, 65]);
  });

  it('rejects text with too few data points, naming the file', () => {
    expect(() => parseRewText('hello\nworld', 'L3.txt')).toThrow(RewParseError);
    expect(() => parseRewText('hello\nworld', 'L3.txt')).toThrow(/L3\.txt/);
  });

  it('rejects frequencies that are not ascending', () => {
    expect(() => parseRewText('10, 60\n1000, 70\n500, 65\n20000, 64', 'R1.txt')).toThrow(/ascending/);
  });

  it('rejects a measurement that does not reach down to 20 Hz', () => {
    expect(() => parseRewText('100, 60\n1000, 70\n20000, 65', 'C1.txt')).toThrow(/cover 20 Hz to 20 kHz/);
  });

  it('rejects a measurement that does not reach up to 20 kHz', () => {
    expect(() => parseRewText('10, 60\n1000, 70\n10000, 65', 'C2.txt')).toThrow(/cover 20 Hz to 20 kHz/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/rewParse.test.ts`
Expected: FAIL — cannot resolve `./rewParse`.

- [ ] **Step 3: Implement**

Create `src/rewParse.ts`:

```ts
export interface RewMeasurement {
  freq: number[];
  spl: number[];
}

export class RewParseError extends Error {}

/** A measurement must start at or below this frequency (Hz)... */
const MAX_FIRST_FREQ_HZ = 20.5;
/** ...and end at or above this one. */
const MIN_LAST_FREQ_HZ = 19500;

/**
 * Parses REW "measurement as text" output: frequency and SPL in the first two
 * columns, any further columns (phase) ignored. Lines that don't start with two
 * numbers (comments, headers, blank lines) are skipped, as are non-positive
 * frequencies. `name` is only used in error messages.
 */
export function parseRewText(text: string, name = 'file'): RewMeasurement {
  const freq: number[] = [];
  const spl: number[] = [];

  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/[\s,;]+/);
    if (tokens.length < 2 || tokens[0] === '' || tokens[1] === '') continue;
    const f = Number(tokens[0]);
    const s = Number(tokens[1]);
    if (!Number.isFinite(f) || !Number.isFinite(s) || f <= 0) continue;
    freq.push(f);
    spl.push(s);
  }

  if (freq.length < 2) {
    throw new RewParseError(`${name}: no numeric frequency/SPL data found`);
  }
  for (let i = 1; i < freq.length; i++) {
    if (freq[i] <= freq[i - 1]) {
      throw new RewParseError(`${name}: frequencies are not in ascending order (at ${freq[i]} Hz)`);
    }
  }
  if (freq[0] > MAX_FIRST_FREQ_HZ || freq[freq.length - 1] < MIN_LAST_FREQ_HZ) {
    throw new RewParseError(
      `${name}: measurement must cover 20 Hz to 20 kHz (this one spans ${freq[0]} Hz to ${freq[freq.length - 1]} Hz)`
    );
  }

  return { freq, spl };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/rewParse.test.ts`
Expected: `10 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/rewParse.ts src/rewParse.test.ts
git commit -m "$(cat <<'EOF'
feat: add a tolerant REW text parser

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Grid, smoothing, averaging and normalisation

**Files:**
- Create: `src/measuredError.ts`
- Create: `src/fixtures/synthMeasurement.ts`
- Test: `src/measuredError.test.ts`

**Interfaces:**
- Consumes: `interpLogFreq` (Task 1), `RewMeasurement` (Task 2).
- Produces (all in `src/measuredError.ts`):
  - `logGrid(): number[]` — the shared 241-point grid (fresh array each call).
  - `smoothToGrid(m: RewMeasurement): number[]` — dB on the grid, 1/6-octave power smoothing; windows with no raw points fall back to log-frequency interpolation.
  - `averagePositions(curves: readonly number[][]): number[]` — power average of dB curves that are already on the grid.
  - `normalizeLevel(curve: readonly number[]): number[]` — subtracts the mean over 500–1500 Hz.
  - `rmsOver(curve: readonly number[], loHz: number, hiHz: number): number` — RMS of grid-aligned values with `loHz <= f <= hiHz` (0 if none).
- Produces (fixtures, `src/fixtures/synthMeasurement.ts`): `synthMeasurement(fn, points = 3000): RewMeasurement` (log-spaced 10 Hz–20 kHz) and `synthRewText(fn, points = 1500, withPhase = false): string`. Consumed by Tasks 4 and 8.

- [ ] **Step 1: Create the synthetic fixtures**

Create `src/fixtures/synthMeasurement.ts`:

```ts
import type { RewMeasurement } from '../rewParse';

/** Dense, log-spaced synthetic measurement from 10 Hz to 20 kHz, for tests. */
export function synthMeasurement(fn: (freq: number) => number, points = 3000): RewMeasurement {
  const freq: number[] = [];
  const spl: number[] = [];
  for (let i = 0; i < points; i++) {
    const f = 10 * 2000 ** (i / (points - 1));
    freq.push(f);
    spl.push(fn(f));
  }
  return { freq, spl };
}

/** The same data as REW-style text ("freq, spl[, phase]"), for parser and generate tests. */
export function synthRewText(fn: (freq: number) => number, points = 1500, withPhase = false): string {
  const m = synthMeasurement(fn, points);
  return m.freq
    .map((f, i) => `${f.toFixed(4)}, ${m.spl[i].toFixed(4)}${withPhase ? ', 0.0000' : ''}`)
    .join('\n');
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/measuredError.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { averagePositions, logGrid, normalizeLevel, rmsOver, smoothToGrid } from './measuredError';
import { synthMeasurement } from './fixtures/synthMeasurement';

const powerMean = (a: number, b: number) => 10 * Math.log10((10 ** (a / 10) + 10 ** (b / 10)) / 2);

describe('logGrid', () => {
  it('has 241 points from exactly 20 Hz to exactly 20 kHz', () => {
    const grid = logGrid();
    expect(grid).toHaveLength(241);
    expect(grid[0]).toBe(20);
    expect(grid[grid.length - 1]).toBe(20000);
  });

  it('is ascending with 24 points per octave', () => {
    const grid = logGrid();
    for (let i = 1; i < grid.length; i++) expect(grid[i]).toBeGreaterThan(grid[i - 1]);
    expect(grid[24] / grid[0]).toBeCloseTo(2, 9);
    expect(grid[1] / grid[0]).toBeCloseTo(2 ** (1 / 24), 9);
  });

  it('returns a fresh array each call', () => {
    const a = logGrid();
    a[0] = 999;
    expect(logGrid()[0]).toBe(20);
  });
});

describe('smoothToGrid', () => {
  it('leaves a flat measurement flat', () => {
    const out = smoothToGrid(synthMeasurement(() => 70));
    expect(out).toHaveLength(241);
    for (const v of out) expect(v).toBeCloseTo(70, 6);
  });

  it('power-averages alternating values inside each window', () => {
    // even points 60 dB, odd points 66 dB: power mean is about 63.96 dB
    let i = 0;
    const out = smoothToGrid(synthMeasurement(() => (i++ % 2 === 0 ? 60 : 66)));
    const grid = logGrid();
    const at1k = out[grid.findIndex((f) => f >= 1000)];
    expect(Math.abs(at1k - powerMean(60, 66))).toBeLessThan(0.1);
  });

  it('interpolates where the raw data is too sparse to fill a window', () => {
    const out = smoothToGrid({ freq: [10, 1000, 20000], spl: [60, 70, 65] });
    // grid[0] is 20 Hz, whose window contains no raw points
    expect(out[0]).toBeCloseTo(60 + (10 * (Math.log10(20) - 1)) / 2, 6);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('averagePositions', () => {
  it('power-averages dB curves', () => {
    const out = averagePositions([
      [60, 60],
      [66, 66],
    ]);
    expect(out[0]).toBeCloseTo(powerMean(60, 66), 9);
    expect(out[1]).toBeCloseTo(powerMean(60, 66), 9);
  });

  it('returns a single curve unchanged', () => {
    const out = averagePositions([[55, 61, 70]]);
    expect(out[0]).toBeCloseTo(55, 9);
    expect(out[2]).toBeCloseTo(70, 9);
  });

  it('throws when given no curves', () => {
    expect(() => averagePositions([])).toThrow();
  });
});

describe('normalizeLevel', () => {
  it('brings a flat curve to zero', () => {
    for (const v of normalizeLevel(logGrid().map(() => 73))) expect(v).toBeCloseTo(0, 9);
  });

  it('preserves shape and zeroes the 500-1500 Hz mean', () => {
    const grid = logGrid();
    const curve = grid.map((_, i) => 73 + i * 0.01);
    const out = normalizeLevel(curve);
    expect(out[10] - out[0]).toBeCloseTo(0.1, 9);
    const band = out.filter((_, i) => grid[i] >= 500 && grid[i] <= 1500);
    expect(band.reduce((a, b) => a + b, 0) / band.length).toBeCloseTo(0, 9);
  });
});

describe('rmsOver', () => {
  it('is the RMS of the values inside the range only', () => {
    const grid = logGrid();
    const curve = grid.map((f) => (f >= 2000 ? 2 : 100));
    expect(rmsOver(curve, 2000, 20000)).toBeCloseTo(2, 9);
  });

  it('returns 0 when no grid point falls in the range', () => {
    expect(rmsOver(logGrid().map(() => 5), 30000, 40000)).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/measuredError.test.ts`
Expected: FAIL — cannot resolve `./measuredError`.

- [ ] **Step 4: Implement**

Create `src/measuredError.ts`:

```ts
import { interpLogFreq } from './logInterp';
import type { RewMeasurement } from './rewParse';

const START_HZ = 20;
const END_HZ = 20000;
const STEPS_PER_OCTAVE = 24;
const SMOOTHING_OCTAVES = 1 / 6;
const NORMALIZE_LO_HZ = 500;
const NORMALIZE_HI_HZ = 1500;

/**
 * The shared log grid: 20 * 2^(i/24) for i = 0..239, plus a final point at
 * exactly 20 kHz (241 points). A fresh array every call.
 */
export function logGrid(): number[] {
  const grid: number[] = [];
  const steps = Math.floor(STEPS_PER_OCTAVE * Math.log2(END_HZ / START_HZ));
  for (let i = 0; i <= steps; i++) grid.push(START_HZ * 2 ** (i / STEPS_PER_OCTAVE));
  if (grid[grid.length - 1] !== END_HZ) grid.push(END_HZ);
  return grid;
}

/** Index of the first element of the ascending `xs` that is >= `x`. */
function lowerBound(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Resamples a measurement onto the log grid: at each grid point, the power
 * average of the raw points within +/- 1/12 octave (1/6-octave window). Where
 * the raw data is too sparse to put any point in a window, interpolates in
 * log-frequency instead. Returns dB.
 */
export function smoothToGrid(m: RewMeasurement): number[] {
  const power = m.spl.map((s) => 10 ** (s / 10));
  const half = 2 ** (SMOOTHING_OCTAVES / 2);
  return logGrid().map((fc) => {
    const a = lowerBound(m.freq, fc / half);
    const b = lowerBound(m.freq, fc * half);
    if (b > a) {
      let sum = 0;
      for (let i = a; i < b; i++) sum += power[i];
      return 10 * Math.log10(sum / (b - a));
    }
    return interpLogFreq(m.freq, m.spl, fc);
  });
}

/** Power average of dB curves that are already on the grid (what REW's RMS average does). */
export function averagePositions(curves: readonly number[][]): number[] {
  if (curves.length === 0) throw new Error('averagePositions: no curves');
  return curves[0].map((_, i) => {
    let sum = 0;
    for (const c of curves) sum += 10 ** (c[i] / 10);
    return 10 * Math.log10(sum / curves.length);
  });
}

/** Subtracts the mean level over 500-1500 Hz so only shape is left. */
export function normalizeLevel(curve: readonly number[]): number[] {
  const grid = logGrid();
  let sum = 0;
  let count = 0;
  grid.forEach((f, i) => {
    if (f >= NORMALIZE_LO_HZ && f <= NORMALIZE_HI_HZ) {
      sum += curve[i];
      count++;
    }
  });
  const mean = sum / count;
  return curve.map((v) => v - mean);
}

/** RMS of the grid-aligned `curve` values with loHz <= f <= hiHz (0 if none). */
export function rmsOver(curve: readonly number[], loHz: number, hiHz: number): number {
  const grid = logGrid();
  let sum = 0;
  let count = 0;
  grid.forEach((f, i) => {
    if (f >= loHz && f <= hiHz) {
      sum += curve[i] ** 2;
      count++;
    }
  });
  return count === 0 ? 0 : Math.sqrt(sum / count);
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/measuredError.test.ts`
Expected: `13 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/measuredError.ts src/measuredError.test.ts src/fixtures/synthMeasurement.ts
git commit -m "$(cat <<'EOF'
feat: add grid, smoothing, averaging and normalisation for measurements

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Effective target and error computation

**Files:**
- Modify: `src/measuredError.ts` (add imports at the top; append the new code)
- Modify: `src/measuredError.test.ts` (append tests; add imports at the top)

**Interfaces:**
- Consumes: everything from Task 3, `AdyChannel` (`src/ady.ts`), `hfKneeGain` (`src/hfKnee.ts`), `synthMeasurement` (Task 3).
- Produces (in `src/measuredError.ts`):
  - `class TargetParseError extends Error`
  - `effectiveTarget(channel: AdyChannel): number[]` — the channel's target on the grid: written curve + knee, level-normalised.
  - `computeError(measurements: readonly RewMeasurement[], channel: AdyChannel): number[]` — measured (smoothed, position-averaged, normalised) minus effective target; throws if `measurements` is empty.

- [ ] **Step 1: Write the failing tests**

At the top of `src/measuredError.test.ts`, change the imports so they read:

```ts
import { describe, it, expect } from 'vitest';
import type { AdyChannel } from './ady';
import { hfKneeGain } from './hfKnee';
import {
  TargetParseError,
  averagePositions,
  computeError,
  effectiveTarget,
  logGrid,
  normalizeLevel,
  rmsOver,
  smoothToGrid,
} from './measuredError';
import { synthMeasurement } from './fixtures/synthMeasurement';
```

Append to the end of the file:

```ts
function channelWith(points: string[]): AdyChannel {
  return { commandId: 'FL', customTargetCurvePoints: points, trimAdjustment: '0.000000' };
}

/** Points in the same "{freq, gain}" format the app writes into .ady files. */
function pointsFor(fn: (f: number) => number): string[] {
  return logGrid().map((f) => `{${f.toFixed(3)}, ${fn(f).toFixed(3)}}`);
}

describe('effectiveTarget', () => {
  it('is the knee alone for a channel with no custom points (stock calibration)', () => {
    const grid = logGrid();
    const target = effectiveTarget(channelWith([]));
    expect(target[grid.length - 1]).toBeCloseTo(hfKneeGain(20000), 3);
    expect(target[grid.findIndex((f) => f >= 1000)]).toBeCloseTo(0, 2);
  });

  it('ignores a constant offset in the written points', () => {
    const stock = effectiveTarget(channelWith([]));
    const offset = effectiveTarget(channelWith(pointsFor(() => 4.5)));
    offset.forEach((v, i) => expect(v).toBeCloseTo(stock[i], 6));
  });

  it('adds the knee on top of the written curve', () => {
    const tilt = (f: number) => -0.7 * Math.log2(f / 1000);
    const grid = logGrid();
    const target = effectiveTarget(channelWith(pointsFor(tilt)));
    // level normalisation shifts everything by a constant, so compare differences
    const i = grid.findIndex((f) => f >= 10000);
    const j = grid.findIndex((f) => f >= 1000);
    const raw = (f: number) => tilt(f) + hfKneeGain(f);
    expect(target[i] - target[j]).toBeCloseTo(raw(grid[i]) - raw(grid[j]), 2);
  });

  it('throws TargetParseError for a point it cannot read', () => {
    expect(() => effectiveTarget(channelWith(['{20.0 4.5}']))).toThrow(TargetParseError);
    expect(() => effectiveTarget(channelWith(['{20.0 4.5}']))).toThrow(/FL/);
  });
});

describe('computeError', () => {
  const tilt = (f: number) => -0.7 * Math.log2(f / 1000);
  const bump = (f: number) => 1.5 * Math.exp(-(Math.log2(f / 8000) ** 2) / (2 * 0.3 ** 2));
  const channel = () => channelWith(pointsFor(tilt));
  // a chain that delivers exactly written + knee, plus a planted error bump at 8 kHz
  const measuredFn = (f: number) => 70 + tilt(f) + hfKneeGain(f) + bump(f);

  it('recovers a planted error shape', () => {
    const grid = logGrid();
    const error = computeError([synthMeasurement(measuredFn)], channel());
    expect(error).toHaveLength(241);
    expect(error[grid.findIndex((f) => f >= 8000)]).toBeCloseTo(1.5, 1);
    expect(error[grid.findIndex((f) => f >= 1000)]).toBeCloseTo(0, 1);
    expect(error[grid.findIndex((f) => f >= 100)]).toBeCloseTo(0, 1);
  });

  it('is near zero everywhere for a chain that hits the target exactly', () => {
    // 0.15 dB rather than tighter: the smoothing window at the 20 kHz edge is one-sided
    const error = computeError([synthMeasurement((f) => 70 + tilt(f) + hfKneeGain(f))], channel());
    for (const v of error) expect(Math.abs(v)).toBeLessThan(0.15);
  });

  it('averages files that use different frequency grids', () => {
    const smooth = (f: number) => 70 + 3 * Math.sin(Math.log2(f));
    const single = computeError([synthMeasurement(smooth, 3000)], channelWith([]));
    const mixed = computeError([synthMeasurement(smooth, 3000), synthMeasurement(smooth, 1500)], channelWith([]));
    single.forEach((v, i) => expect(Math.abs(v - mixed[i])).toBeLessThan(0.05));
  });

  it('throws when given no measurements', () => {
    expect(() => computeError([], channel())).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/measuredError.test.ts`
Expected: FAIL — `effectiveTarget`, `computeError` and `TargetParseError` are not exported.

- [ ] **Step 3: Implement**

At the top of `src/measuredError.ts`, make the imports read:

```ts
import type { AdyChannel } from './ady';
import { hfKneeGain } from './hfKnee';
import { interpLogFreq } from './logInterp';
import type { RewMeasurement } from './rewParse';
```

Append to the end of `src/measuredError.ts`:

```ts
/** Thrown when a channel's customTargetCurvePoints can't be read. */
export class TargetParseError extends Error {}

const POINT_PATTERN = /^\{\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\}$/;

/** The channel's written curve (dB) on the grid; all zeros when it has no custom points. */
function writtenCurve(channel: AdyChannel): number[] {
  const grid = logGrid();
  if (channel.customTargetCurvePoints.length === 0) return grid.map(() => 0);

  const points = channel.customTargetCurvePoints.map((raw) => {
    const match = POINT_PATTERN.exec(String(raw).trim());
    const freq = match ? Number(match[1]) : NaN;
    const gain = match ? Number(match[2]) : NaN;
    if (!Number.isFinite(freq) || !Number.isFinite(gain) || freq <= 0) {
      throw new TargetParseError(`Channel ${channel.commandId}: cannot read curve point "${String(raw)}"`);
    }
    return { freq, gain };
  });
  points.sort((a, b) => a.freq - b.freq);
  const xs = points.map((p) => p.freq);
  const ys = points.map((p) => p.gain);
  return grid.map((f) => interpLogFreq(xs, ys, f));
}

/**
 * What Audyssey is actually aiming for on this channel: the written curve plus
 * the HF knee it always applies on top (the knee alone for a stock
 * calibration), level-normalised so only shape matters.
 */
export function effectiveTarget(channel: AdyChannel): number[] {
  const grid = logGrid();
  const written = writtenCurve(channel);
  return normalizeLevel(grid.map((f, i) => written[i] + hfKneeGain(f)));
}

/**
 * E(f) = measured - target, on the grid: the measurements are smoothed,
 * power-averaged across positions and level-normalised, then the channel's
 * effective target is subtracted.
 */
export function computeError(measurements: readonly RewMeasurement[], channel: AdyChannel): number[] {
  if (measurements.length === 0) throw new Error('computeError: no measurements');
  const measured = normalizeLevel(averagePositions(measurements.map(smoothToGrid)));
  const target = effectiveTarget(channel);
  return measured.map((v, i) => v - target[i]);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/measuredError.test.ts`
Expected: `21 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/measuredError.ts src/measuredError.test.ts
git commit -m "$(cat <<'EOF'
feat: compute the measured-vs-target error curve for a channel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Correction file format

**Files:**
- Create: `src/correction.ts`
- Test: `src/correction.test.ts`

**Interfaces:**
- Consumes: `logGrid` (Task 3).
- Produces (in `src/correction.ts`):
  - `interface CorrectionChannel { positions: number; error: number[] }`
  - `interface CorrectionFile { version: 1; created: string; label: string; freq: number[]; channels: Record<string, CorrectionChannel> }`
  - `class CorrectionValidationError extends Error`
  - `createCorrection(channels: Record<string, CorrectionChannel>, label: string, now?: Date): CorrectionFile` — `freq` is `logGrid()`, `created` is `now.toISOString()`.
  - `serializeCorrection(c: CorrectionFile): string`
  - `parseCorrection(text: string): CorrectionFile` — validates; throws `CorrectionValidationError`. `label` is optional in the file and defaults to `''`.

- [ ] **Step 1: Write the failing tests**

Create `src/correction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CorrectionValidationError,
  createCorrection,
  parseCorrection,
  serializeCorrection,
  type CorrectionFile,
} from './correction';
import { logGrid } from './measuredError';

function sample(): CorrectionFile {
  const error = logGrid().map((_, i) => i * 0.01);
  return createCorrection({ FL: { positions: 3, error } }, 'test mic', new Date('2026-09-20T12:00:00Z'));
}

/** parseCorrection on a modified copy of a valid file. */
function parseWith(mutate: (raw: Record<string, any>) => void): CorrectionFile {
  const raw = JSON.parse(serializeCorrection(sample()));
  mutate(raw);
  return parseCorrection(JSON.stringify(raw));
}

describe('createCorrection', () => {
  it('stamps version, label, timestamp and the shared grid', () => {
    const c = sample();
    expect(c.version).toBe(1);
    expect(c.label).toBe('test mic');
    expect(c.created).toBe('2026-09-20T12:00:00.000Z');
    expect(c.freq).toEqual(logGrid());
    expect(c.channels.FL.positions).toBe(3);
  });
});

describe('serializeCorrection / parseCorrection', () => {
  it('round-trips', () => {
    const c = sample();
    expect(parseCorrection(serializeCorrection(c))).toEqual(c);
  });

  it('defaults a missing label to an empty string', () => {
    expect(parseWith((raw) => delete raw.label).label).toBe('');
  });
});

describe('parseCorrection validation', () => {
  it('rejects text that is not JSON', () => {
    expect(() => parseCorrection('{nope')).toThrow(CorrectionValidationError);
  });

  it('rejects a non-object top level', () => {
    expect(() => parseCorrection('[1,2]')).toThrow(CorrectionValidationError);
  });

  it('rejects an unsupported version', () => {
    expect(() => parseWith((raw) => (raw.version = 2))).toThrow(/version/);
  });

  it('rejects a missing timestamp', () => {
    expect(() => parseWith((raw) => delete raw.created)).toThrow(/created/);
  });

  it('rejects a freq array that is not ascending', () => {
    expect(() => parseWith((raw) => ([raw.freq[3], raw.freq[4]] = [raw.freq[4], raw.freq[3]]))).toThrow(/ascending/);
  });

  it('rejects non-finite or non-positive frequencies', () => {
    expect(() => parseWith((raw) => (raw.freq[0] = -5))).toThrow(CorrectionValidationError);
    expect(() => parseWith((raw) => (raw.freq[2] = 'x'))).toThrow(CorrectionValidationError);
  });

  it('rejects a channels value that is not an object', () => {
    expect(() => parseWith((raw) => (raw.channels = []))).toThrow(/channels/);
  });

  it('rejects an error array of the wrong length, naming the channel', () => {
    expect(() => parseWith((raw) => raw.channels.FL.error.pop())).toThrow(/FL/);
  });

  it('rejects non-finite error values', () => {
    expect(() => parseWith((raw) => (raw.channels.FL.error[5] = null))).toThrow(/FL/);
  });

  it('rejects a bad positions count', () => {
    expect(() => parseWith((raw) => (raw.channels.FL.positions = 0))).toThrow(/positions/);
    expect(() => parseWith((raw) => (raw.channels.FL.positions = 2.5))).toThrow(/positions/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/correction.test.ts`
Expected: FAIL — cannot resolve `./correction`.

- [ ] **Step 3: Implement**

Create `src/correction.ts`:

```ts
import { logGrid } from './measuredError';

export interface CorrectionChannel {
  /** How many measurement positions were averaged into `error`. */
  positions: number;
  /** measured - target (dB) at each entry of the file's `freq`. */
  error: number[];
}

export interface CorrectionFile {
  version: 1;
  created: string;
  label: string;
  freq: number[];
  channels: Record<string, CorrectionChannel>;
}

export class CorrectionValidationError extends Error {}

export function createCorrection(
  channels: Record<string, CorrectionChannel>,
  label: string,
  now: Date = new Date()
): CorrectionFile {
  return { version: 1, created: now.toISOString(), label, freq: logGrid(), channels };
}

export function serializeCorrection(correction: CorrectionFile): string {
  return JSON.stringify(correction);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Parses and validates a correction file. Throws CorrectionValidationError with the reason. */
export function parseCorrection(text: string): CorrectionFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new CorrectionValidationError(`Not valid JSON: ${(err as Error).message}`);
  }
  if (!isObject(raw)) throw new CorrectionValidationError('Top level of the file is not an object');
  if (raw.version !== 1) {
    throw new CorrectionValidationError(`Unsupported correction file version: ${String(raw.version)}`);
  }
  if (typeof raw.created !== 'string') throw new CorrectionValidationError('Missing "created" timestamp');
  const label = typeof raw.label === 'string' ? raw.label : '';

  const freq = raw.freq;
  if (!Array.isArray(freq) || freq.length < 2 || !freq.every(isFiniteNumber)) {
    throw new CorrectionValidationError('"freq" must be an array of at least two finite numbers');
  }
  if (freq[0] <= 0) throw new CorrectionValidationError('"freq" must be positive');
  for (let i = 1; i < freq.length; i++) {
    if (freq[i] <= freq[i - 1]) throw new CorrectionValidationError('"freq" must be strictly ascending');
  }

  if (!isObject(raw.channels)) throw new CorrectionValidationError('"channels" must be an object');
  const channels: Record<string, CorrectionChannel> = {};
  for (const [id, value] of Object.entries(raw.channels)) {
    if (!isObject(value)) throw new CorrectionValidationError(`Channel ${id} is not an object`);
    const positions = value.positions;
    if (typeof positions !== 'number' || !Number.isInteger(positions) || positions < 1) {
      throw new CorrectionValidationError(`Channel ${id}: "positions" must be a positive integer`);
    }
    const error = value.error;
    if (!Array.isArray(error) || error.length !== freq.length || !error.every(isFiniteNumber)) {
      throw new CorrectionValidationError(`Channel ${id}: "error" must be ${freq.length} finite numbers`);
    }
    channels[id] = { positions, error };
  }

  return { version: 1, created: raw.created, label, freq, channels };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/correction.test.ts`
Expected: `13 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/correction.ts src/correction.test.ts
git commit -m "$(cat <<'EOF'
feat: add the correction file format with validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Deriving the trim

**Files:**
- Modify: `src/curve.ts` (export `smoothstep`; add the `TrimFn` type)
- Modify: `src/correction.ts` (add imports at the top; append the new code)
- Modify: `src/correction.test.ts` (append tests; extend the import at the top)

**Interfaces:**
- Consumes: `interpLogFreq` (Task 1), `CorrectionFile` and friends (Task 5), `logGrid` (Task 3).
- Produces:
  - in `src/curve.ts`: `export type TrimFn = (freq: number) => number;` and `smoothstep` now exported (`smoothstep(t: number): number`, clamps `t` to 0..1).
  - in `src/correction.ts`:
    - `DEFAULT_CUTOFF_HZ = 2000`
    - `trimFromError(error: readonly number[], freq: readonly number[], cutoffHz: number): TrimFn`
    - `buildChannelTrims(correction: CorrectionFile, cutoffHz: number): Map<string, TrimFn>`
    - `interface TrimSummaryRow { commandId: string; positions: number; maxAbsTrim: number; inBase: boolean }`
    - `summarizeCorrection(correction: CorrectionFile, cutoffHz: number, baseChannelIds: readonly string[]): TrimSummaryRow[]` — `inBase` is true when `baseChannelIds` is empty (no base file loaded yet) or contains the channel.

- [ ] **Step 1: Make `smoothstep` reusable and add the `TrimFn` type**

In `src/curve.ts`, change the line

```ts
function smoothstep(t: number): number {
```

to

```ts
export function smoothstep(t: number): number {
```

and add, directly above the `export interface CurveParams {` line:

```ts
/** Extra gain (dB) added on top of a channel's written curve, as a function of frequency. */
export type TrimFn = (freq: number) => number;
```

Run: `npx vitest run src/curve.test.ts`
Expected: `20 passed` (nothing else changed).

- [ ] **Step 2: Write the failing tests**

In `src/correction.test.ts`, change the import from `./correction` to:

```ts
import {
  CorrectionValidationError,
  DEFAULT_CUTOFF_HZ,
  buildChannelTrims,
  createCorrection,
  parseCorrection,
  serializeCorrection,
  summarizeCorrection,
  trimFromError,
  type CorrectionFile,
} from './correction';
```

Append to the end of the file:

```ts
describe('trimFromError', () => {
  const freq = logGrid();
  const flat = (v: number) => freq.map(() => v);

  it('defaults the cutoff to 2 kHz', () => {
    expect(DEFAULT_CUTOFF_HZ).toBe(2000);
  });

  it('is zero below the fade, half at the cutoff and full above it (for a flat error)', () => {
    const trim = trimFromError(flat(2), freq, 2000);
    expect(trim(1000)).toBeCloseTo(0, 6);
    expect(trim(2000)).toBeCloseTo(-1, 1);
    expect(trim(2900)).toBeCloseTo(-2, 2);
    expect(trim(10000)).toBeCloseTo(-2, 6);
    expect(trim(20000)).toBeCloseTo(-2, 6);
  });

  it('is the negative of the error (a positive error gives a cut, a negative one a boost)', () => {
    expect(trimFromError(flat(-2), freq, 2000)(10000)).toBeCloseTo(2, 6);
  });

  it('clamps to +/-3 dB', () => {
    expect(trimFromError(flat(10), freq, 2000)(10000)).toBeCloseTo(-3, 6);
    expect(trimFromError(flat(-10), freq, 2000)(10000)).toBeCloseTo(3, 6);
  });

  it('moves the fade with the cutoff', () => {
    const trim = trimFromError(flat(2), freq, 4000);
    expect(trim(2000)).toBeCloseTo(0, 6);
    expect(trim(8000)).toBeCloseTo(-2, 6);
  });

  it('smooths a single-point spike instead of chasing it', () => {
    const error = flat(0);
    error[freq.findIndex((f) => f >= 8000)] = 10;
    const trim = trimFromError(error, freq, 2000);
    for (const f of freq) expect(Math.abs(trim(f))).toBeLessThan(0.5);
  });

  it('interpolates between grid points and clamps beyond the ends', () => {
    const error = freq.map((f) => (f >= 5000 ? 2 : 0));
    const trim = trimFromError(error, freq, 1000);
    const between = trim(Math.sqrt(freq[100] * freq[101]));
    const lo = Math.min(trim(freq[100]), trim(freq[101]));
    const hi = Math.max(trim(freq[100]), trim(freq[101]));
    expect(between).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(between).toBeLessThanOrEqual(hi + 1e-9);
    expect(trim(50000)).toBeCloseTo(trim(20000), 9);
    expect(trim(5)).toBeCloseTo(trim(20), 9);
  });
});

describe('buildChannelTrims / summarizeCorrection', () => {
  const freq = logGrid();
  const correction: CorrectionFile = createCorrection(
    {
      FL: { positions: 3, error: freq.map(() => 2) },
      FR: { positions: 2, error: freq.map(() => -1) },
    },
    '',
    new Date('2026-09-20T12:00:00Z')
  );

  it('builds one trim function per channel', () => {
    const trims = buildChannelTrims(correction, 2000);
    expect([...trims.keys()].sort()).toEqual(['FL', 'FR']);
    expect(trims.get('FL')!(10000)).toBeCloseTo(-2, 6);
    expect(trims.get('FR')!(10000)).toBeCloseTo(1, 6);
  });

  it('summarises positions and the largest trim per channel', () => {
    const rows = summarizeCorrection(correction, 2000, ['FL', 'FR', 'C']);
    const fl = rows.find((r) => r.commandId === 'FL')!;
    expect(fl.positions).toBe(3);
    expect(fl.maxAbsTrim).toBeCloseTo(2, 6);
    expect(fl.inBase).toBe(true);
  });

  it('flags channels the base file does not have', () => {
    const rows = summarizeCorrection(correction, 2000, ['FL', 'C']);
    expect(rows.find((r) => r.commandId === 'FR')!.inBase).toBe(false);
  });

  it('treats every channel as present when no base file is loaded yet', () => {
    const rows = summarizeCorrection(correction, 2000, []);
    expect(rows.every((r) => r.inBase)).toBe(true);
  });

  it('reports a smaller largest trim for a higher cutoff', () => {
    const low = summarizeCorrection(correction, 2000, [])[0].maxAbsTrim;
    const none = summarizeCorrection(correction, 60000, [])[0].maxAbsTrim;
    expect(low).toBeGreaterThan(none);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/correction.test.ts`
Expected: FAIL — `trimFromError`, `buildChannelTrims`, `summarizeCorrection` and `DEFAULT_CUTOFF_HZ` are not exported.

- [ ] **Step 4: Implement**

At the top of `src/correction.ts`, make the imports read:

```ts
import { smoothstep, type TrimFn } from './curve';
import { interpLogFreq } from './logInterp';
import { logGrid } from './measuredError';
```

Append to the end of `src/correction.ts`:

```ts
export const DEFAULT_CUTOFF_HZ = 2000;

/** Grid points either side of centre for the 1-octave box smoothing (24 points per octave). */
const SMOOTH_HALF_WIDTH_POINTS = 12;
const TRIM_CLAMP_DB = 3;
/** The trim fades in over this many octaves, centred on the cutoff. */
const FADE_WIDTH_OCTAVES = 1;

/**
 * Turns a measured error curve into a trim: 1-octave smoothing, clamp to
 * +/-3 dB, fade in around the cutoff, negate. The returned function looks the
 * trim up by log-frequency interpolation between `freq` points.
 */
export function trimFromError(error: readonly number[], freq: readonly number[], cutoffHz: number): TrimFn {
  const n = error.length;
  const trims = error.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - SMOOTH_HALF_WIDTH_POINTS; j <= i + SMOOTH_HALF_WIDTH_POINTS; j++) {
      sum += error[Math.min(n - 1, Math.max(0, j))];
      count++;
    }
    const clamped = Math.max(-TRIM_CLAMP_DB, Math.min(TRIM_CLAMP_DB, sum / count));
    const weight = smoothstep(Math.log2(freq[i] / cutoffHz) / FADE_WIDTH_OCTAVES + 0.5);
    return -weight * clamped;
  });
  return (f: number) => interpLogFreq(freq, trims, f);
}

/** One trim function per channel in the correction, for the given cutoff. */
export function buildChannelTrims(correction: CorrectionFile, cutoffHz: number): Map<string, TrimFn> {
  const trims = new Map<string, TrimFn>();
  for (const [id, channel] of Object.entries(correction.channels)) {
    trims.set(id, trimFromError(channel.error, correction.freq, cutoffHz));
  }
  return trims;
}

export interface TrimSummaryRow {
  commandId: string;
  positions: number;
  maxAbsTrim: number;
  /** False when a base .ady is loaded and lacks this channel (the entry is ignored). */
  inBase: boolean;
}

export function summarizeCorrection(
  correction: CorrectionFile,
  cutoffHz: number,
  baseChannelIds: readonly string[]
): TrimSummaryRow[] {
  return Object.entries(correction.channels).map(([commandId, channel]) => {
    const trim = trimFromError(channel.error, correction.freq, cutoffHz);
    let maxAbsTrim = 0;
    for (const f of correction.freq) maxAbsTrim = Math.max(maxAbsTrim, Math.abs(trim(f)));
    return {
      commandId,
      positions: channel.positions,
      maxAbsTrim,
      inBase: baseChannelIds.length === 0 || baseChannelIds.includes(commandId),
    };
  });
}
```

Note: `logGrid` was already imported in `correction.ts` by Task 5 (used by `createCorrection`); keep a single import line for it.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/correction.test.ts`
Expected: `25 passed`.

- [ ] **Step 6: Run everything and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/curve.ts src/correction.ts src/correction.test.ts
git commit -m "$(cat <<'EOF'
feat: derive a per-channel trim from a measured error curve

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Per-channel trims in the export

**Files:**
- Modify: `src/ady.ts`
- Modify: `src/ady.test.ts`

**Interfaces:**
- Consumes: `TrimFn`, `writtenGain`, `frequencyGrid`, `computeTrimShift`, `CurveParams` (`src/curve.ts`).
- Produces (in `src/ady.ts`):
  - `applyCurveToAdy(ady: AdyFile, params: CurveParams, trims?: ReadonlyMap<string, TrimFn>): AdyFile` — non-sub channels whose `commandId` is in `trims` get `writtenGain(f, params) + trim(f)`; everything else is exactly as before. Sub trim-shift logic unchanged. Consumed by Task 9.
  - `hasAppliedTrims(ady: AdyFile, trims: ReadonlyMap<string, TrimFn> | undefined): boolean` — true when at least one non-sub channel of `ady` has an entry in `trims`.

- [ ] **Step 1: Write the failing tests**

In `src/ady.test.ts`, update the two mid-file import lines (currently `import { applyCurveToAdy, serializeAdy } from './ady';` and `import { computeTrimShift, designGain, frequencyGrid, type CurveParams } from './curve';`) so they read:

```ts
import { applyCurveToAdy, hasAppliedTrims, serializeAdy } from './ady';
import { computeTrimShift, designGain, frequencyGrid, writtenGain, type CurveParams, type TrimFn } from './curve';
```

Append to the end of the file:

```ts
describe('applyCurveToAdy with per-channel trims', () => {
  const params: CurveParams = { slope: 0.7, shelfEnabled: false, shelfGain: 0 };
  const trim: TrimFn = (f) => (f >= 5000 ? -1.5 : 0);

  function threeChannelAdy() {
    const ady = createSampleAdy();
    ady.detectedChannels.push({ commandId: 'FR', customTargetCurvePoints: [], trimAdjustment: '0.000000' });
    return ady;
  }
  const pointsOf = (ady: ReturnType<typeof threeChannelAdy>, id: string) =>
    ady.detectedChannels.find((c) => c.commandId === id)!.customTargetCurvePoints;

  it('is identical to the untrimmed output when the trims map is empty', () => {
    expect(applyCurveToAdy(threeChannelAdy(), params, new Map())).toEqual(
      applyCurveToAdy(threeChannelAdy(), params)
    );
  });

  it('adds the trim only to the channel that has one', () => {
    const result = applyCurveToAdy(threeChannelAdy(), params, new Map([['FL', trim]]));
    const fl = pointsOf(result, 'FL');
    const fr = pointsOf(result, 'FR');
    expect(fl[fl.length - 1]).toBe(`{20000.0, ${(writtenGain(20000, params) - 1.5).toFixed(3)}}`);
    expect(fr[fr.length - 1]).toBe(`{20000.0, ${writtenGain(20000, params).toFixed(3)}}`);
    // below the trim's own onset the two channels are identical
    expect(fl[0]).toBe(fr[0]);
    expect(fl).toHaveLength(frequencyGrid().length);
  });

  it('never trims a subwoofer, even if the map names it', () => {
    const plain = applyCurveToAdy(threeChannelAdy(), params);
    const result = applyCurveToAdy(threeChannelAdy(), params, new Map([['SW1', trim]]));
    expect(pointsOf(result, 'SW1')).toEqual(pointsOf(plain, 'SW1'));
  });

  it('leaves the subwoofer trim shift untouched', () => {
    const plain = applyCurveToAdy(threeChannelAdy(), params);
    const result = applyCurveToAdy(threeChannelAdy(), params, new Map([['FL', trim]]));
    const sw = (a: typeof plain) => a.detectedChannels.find((c) => c.commandId === 'SW1')!.trimAdjustment;
    expect(sw(result)).toBe(sw(plain));
  });

  it('does not mutate the input', () => {
    const input = threeChannelAdy();
    applyCurveToAdy(input, params, new Map([['FL', trim]]));
    expect(pointsOf(input, 'FL')).toEqual([]);
  });
});

describe('hasAppliedTrims', () => {
  const ady = createSampleAdy(); // FL and SW1
  const trim: TrimFn = () => 0;

  it('is false when there are no trims', () => {
    expect(hasAppliedTrims(ady, undefined)).toBe(false);
    expect(hasAppliedTrims(ady, new Map())).toBe(false);
  });

  it('is true when a non-sub channel of the file has a trim', () => {
    expect(hasAppliedTrims(ady, new Map([['FL', trim]]))).toBe(true);
  });

  it('is false when only the subwoofer or unknown channels have trims', () => {
    expect(hasAppliedTrims(ady, new Map([['SW1', trim]]))).toBe(false);
    expect(hasAppliedTrims(ady, new Map([['XX', trim]]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ady.test.ts`
Expected: FAIL — `hasAppliedTrims` is not exported / the third argument is ignored (the "adds the trim only to the channel that has one" test fails).

- [ ] **Step 3: Implement**

In `src/ady.ts`:

1. Delete the mid-file line `import { frequencyGrid, writtenGain, computeTrimShift, type CurveParams } from './curve';` (currently line 65) and add this as the **first line** of the file, followed by a blank line:

```ts
import { frequencyGrid, writtenGain, computeTrimShift, type CurveParams, type TrimFn } from './curve';
```

2. Replace the whole `applyCurveToAdy` function (doc comment included) with:

```ts
/**
 * Returns a new AdyFile with the designed curve written to every channel,
 * subwoofer trim compensated, and enTargetCurveType forced to the value
 * that matches the modeled HF knee. Non-subwoofer channels that have an entry
 * in `trims` get that per-channel trim added on top of the shared curve.
 * Does not mutate the input.
 */
export function applyCurveToAdy(
  ady: AdyFile,
  params: CurveParams,
  trims?: ReadonlyMap<string, TrimFn>
): AdyFile {
  const clone = JSON.parse(JSON.stringify(ady)) as AdyFile;
  const grid = frequencyGrid();
  const sharedPoints = grid.map((f) => formatPoint(f, writtenGain(f, params)));
  const trimShift = computeTrimShift(params);

  for (const channel of clone.detectedChannels) {
    const trim = isSubwooferChannel(channel) ? undefined : trims?.get(channel.commandId);
    channel.customTargetCurvePoints = trim
      ? grid.map((f) => formatPoint(f, writtenGain(f, params) + trim(f)))
      : sharedPoints;
    if (isSubwooferChannel(channel)) {
      const originalTrim = parseFloat(channel.trimAdjustment);
      channel.trimAdjustment = (originalTrim + trimShift).toFixed(6);
    }
  }

  clone.enTargetCurveType = FORCED_TARGET_CURVE_TYPE;
  return clone;
}

/** True when at least one non-subwoofer channel of `ady` has an entry in `trims`. */
export function hasAppliedTrims(ady: AdyFile, trims: ReadonlyMap<string, TrimFn> | undefined): boolean {
  if (!trims) return false;
  return ady.detectedChannels.some((c) => !isSubwooferChannel(c) && trims.has(c.commandId));
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/ady.test.ts`
Expected: all pass (the previous 15 plus 8 new = 23).

- [ ] **Step 5: Run everything and build**

Run: `npm test && npm run build`
Expected: all pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/ady.ts src/ady.test.ts
git commit -m "$(cat <<'EOF'
feat: let the export apply per-channel trims

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Generating a correction from files

**Files:**
- Create: `src/generate.ts`
- Test: `src/generate.test.ts`

**Interfaces:**
- Consumes: `parseRewText` (Task 2), `computeError`/`rmsOver` (Tasks 3–4), `createCorrection` (Task 5), `isSubwooferChannel`/`AdyFile` (`src/ady.ts`).
- Produces (in `src/generate.ts`):
  - `REQUIRED_TARGET_CURVE_TYPE = 2`
  - `class GenerateError extends Error`
  - `interface SpeakerInput { commandId: string; files: { name: string; text: string }[] }`
  - `interface ChannelReport { commandId: string; positions: number; rmsError: number }`
  - `interface GenerateResult { correction: CorrectionFile; reports: ChannelReport[]; warnings: string[] }`
  - `generateCorrection(measuredAdy: AdyFile, speakers: readonly SpeakerInput[], label: string, now?: Date): GenerateResult` — speakers with no files are skipped; throws `GenerateError` for a wrong `enTargetCurveType`, no files at all, an unknown or subwoofer channel, or a channel given twice; parse errors from `parseRewText` propagate unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/generate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AdyFile } from './ady';
import { createSampleAdy } from './fixtures/sampleAdy';
import { synthRewText } from './fixtures/synthMeasurement';
import { GenerateError, REQUIRED_TARGET_CURVE_TYPE, generateCorrection } from './generate';
import { hfKneeGain } from './hfKnee';
import { logGrid } from './measuredError';
import { RewParseError } from './rewParse';

function measuredAdy(): AdyFile {
  const ady = createSampleAdy(); // FL and SW1
  ady.enTargetCurveType = REQUIRED_TARGET_CURVE_TYPE;
  ady.detectedChannels.push({ commandId: 'FR', customTargetCurvePoints: [], trimAdjustment: '0.000000' });
  return ady;
}

// The stock target is the knee alone, so "flat + knee + bump" measures as an error equal to the bump.
const bump = (f: number) => 1.5 * Math.exp(-(Math.log2(f / 8000) ** 2) / (2 * 0.3 ** 2));
const measuredFn = (f: number) => 70 + hfKneeGain(f) + bump(f);
const file = (name: string, fn = measuredFn) => ({ name, text: synthRewText(fn) });
const NOW = new Date('2026-09-20T12:00:00Z');

describe('generateCorrection', () => {
  it('builds a correction with the averaged position count and the planted error', () => {
    const { correction, reports, warnings } = generateCorrection(
      measuredAdy(),
      [{ commandId: 'FL', files: [file('L1.txt'), file('L2.txt')] }],
      'test mic',
      NOW
    );
    const i = logGrid().findIndex((f) => f >= 8000);
    expect(Object.keys(correction.channels)).toEqual(['FL']);
    expect(correction.channels.FL.positions).toBe(2);
    expect(correction.channels.FL.error[i]).toBeCloseTo(1.5, 1);
    expect(correction.label).toBe('test mic');
    expect(correction.created).toBe(NOW.toISOString());
    expect(reports).toHaveLength(1);
    expect(reports[0].commandId).toBe('FL');
    expect(reports[0].positions).toBe(2);
    expect(Number.isFinite(reports[0].rmsError)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('accepts REW files that carry a phase column', () => {
    const phased = { name: 'L1.txt', text: synthRewText(measuredFn, 1500, true) };
    const { correction } = generateCorrection(measuredAdy(), [{ commandId: 'FL', files: [phased] }], '', NOW);
    expect(correction.channels.FL.positions).toBe(1);
  });

  it('skips speakers with no files but processes the others', () => {
    const { correction } = generateCorrection(
      measuredAdy(),
      [
        { commandId: 'FL', files: [file('L1.txt')] },
        { commandId: 'FR', files: [] },
      ],
      '',
      NOW
    );
    expect(Object.keys(correction.channels)).toEqual(['FL']);
  });

  it('refuses a measured .ady that is not enTargetCurveType 2', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 0;
    expect(() => generateCorrection(ady, [{ commandId: 'FL', files: [file('L1.txt')] }], '')).toThrow(GenerateError);
    expect(() => generateCorrection(ady, [{ commandId: 'FL', files: [file('L1.txt')] }], '')).toThrow(/enTargetCurveType/);
  });

  it('throws when no speaker has any files', () => {
    expect(() => generateCorrection(measuredAdy(), [], '')).toThrow(GenerateError);
    expect(() => generateCorrection(measuredAdy(), [{ commandId: 'FL', files: [] }], '')).toThrow(/No measurement files/);
  });

  it('throws for a channel the .ady does not have', () => {
    expect(() => generateCorrection(measuredAdy(), [{ commandId: 'XX', files: [file('a.txt')] }], '')).toThrow(/XX/);
  });

  it('throws for the subwoofer', () => {
    expect(() => generateCorrection(measuredAdy(), [{ commandId: 'SW1', files: [file('a.txt')] }], '')).toThrow(/subwoofer/);
  });

  it('throws when a channel is given twice', () => {
    expect(() =>
      generateCorrection(
        measuredAdy(),
        [
          { commandId: 'FL', files: [file('a.txt')] },
          { commandId: 'FL', files: [file('b.txt')] },
        ],
        ''
      )
    ).toThrow(/twice/);
  });

  it('warns when a speaker looks far off, without blocking', () => {
    const wild = (f: number) => 70 + hfKneeGain(f) + (f > 3000 ? 10 : 0);
    const { correction, warnings } = generateCorrection(
      measuredAdy(),
      [{ commandId: 'FL', files: [file('L1.txt', wild)] }],
      '',
      NOW
    );
    expect(correction.channels.FL).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/FL/);
  });

  it('lets a parse error through, naming the file', () => {
    const run = () =>
      generateCorrection(measuredAdy(), [{ commandId: 'FL', files: [{ name: 'L3.txt', text: 'garbage' }] }], '');
    expect(run).toThrow(RewParseError);
    expect(run).toThrow(/L3\.txt/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/generate.test.ts`
Expected: FAIL — cannot resolve `./generate`.

- [ ] **Step 3: Implement**

Create `src/generate.ts`:

```ts
import { isSubwooferChannel, type AdyFile } from './ady';
import { createCorrection, type CorrectionChannel, type CorrectionFile } from './correction';
import { computeError, rmsOver } from './measuredError';
import { parseRewText } from './rewParse';

/** The HF knee is only valid for this target curve type, so the measured file must use it. */
export const REQUIRED_TARGET_CURVE_TYPE = 2;

/** RMS error (dB, 2-20 kHz) above which a speaker gets a warning. */
const RMS_WARNING_DB = 4;

export class GenerateError extends Error {}

export interface SpeakerInput {
  commandId: string;
  files: { name: string; text: string }[];
}

export interface ChannelReport {
  commandId: string;
  positions: number;
  /** RMS of the error curve over 2-20 kHz, in dB. */
  rmsError: number;
}

export interface GenerateResult {
  correction: CorrectionFile;
  reports: ChannelReport[];
  warnings: string[];
}

/**
 * Builds a correction file from REW exports. `measuredAdy` is the .ady the
 * measurements were made with (it supplies each channel's actual target).
 * Speakers with no files are skipped.
 */
export function generateCorrection(
  measuredAdy: AdyFile,
  speakers: readonly SpeakerInput[],
  label: string,
  now: Date = new Date()
): GenerateResult {
  if (measuredAdy.enTargetCurveType !== REQUIRED_TARGET_CURVE_TYPE) {
    throw new GenerateError(
      `The measured .ady must have enTargetCurveType ${REQUIRED_TARGET_CURVE_TYPE}, but this one has ${measuredAdy.enTargetCurveType}.`
    );
  }
  const active = speakers.filter((s) => s.files.length > 0);
  if (active.length === 0) throw new GenerateError('No measurement files were given.');

  const channels: Record<string, CorrectionChannel> = {};
  const reports: ChannelReport[] = [];
  const warnings: string[] = [];

  for (const speaker of active) {
    const channel = measuredAdy.detectedChannels.find((c) => c.commandId === speaker.commandId);
    if (!channel) throw new GenerateError(`The measured .ady has no channel ${speaker.commandId}.`);
    if (isSubwooferChannel(channel)) {
      throw new GenerateError(`Channel ${speaker.commandId} is a subwoofer and can't be corrected.`);
    }
    if (channels[speaker.commandId]) {
      throw new GenerateError(`Channel ${speaker.commandId} was given twice.`);
    }

    const measurements = speaker.files.map((f) => parseRewText(f.text, f.name));
    const error = computeError(measurements, channel);
    const rmsError = rmsOver(error, 2000, 20000);

    channels[speaker.commandId] = { positions: measurements.length, error };
    reports.push({ commandId: speaker.commandId, positions: measurements.length, rmsError });
    if (rmsError > RMS_WARNING_DB) {
      warnings.push(
        `${speaker.commandId}: error is ${rmsError.toFixed(1)} dB RMS over 2-20 kHz. Check that the right files are on this channel.`
      );
    }
  }

  return { correction: createCorrection(channels, label, now), reports, warnings };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/generate.test.ts`
Expected: `10 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/generate.ts src/generate.test.ts
git commit -m "$(cat <<'EOF'
feat: generate a correction file from REW exports

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The "Measured correction" UI

**Files:**
- Modify: `index.html`
- Modify: `src/style.css`
- Create: `src/correctionUi.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `parseAdy`, `isSubwooferChannel`, `AdyFile` (`src/ady.ts`); `TrimFn` (`src/curve.ts`); `DEFAULT_CUTOFF_HZ`, `buildChannelTrims`, `parseCorrection`, `serializeCorrection`, `summarizeCorrection`, `CorrectionFile` (`src/correction.ts`); `REQUIRED_TARGET_CURVE_TYPE`, `generateCorrection`, `SpeakerInput`, `GenerateResult` (`src/generate.ts`); `hasAppliedTrims`, `applyCurveToAdy` (`src/ady.ts`).
- Produces (in `src/correctionUi.ts`):
  - `interface CorrectionUi { setBaseChannels(ids: string[]): void; getTrims(): ReadonlyMap<string, TrimFn> | undefined }`
  - `initCorrectionUi(onChange: () => void): CorrectionUi` — wires the new DOM section; calls `onChange` whenever the active correction, its enabled checkbox or the cutoff changes.

DOM-facing code has no automated tests in this project (see the original design's constraints); it is verified by build, a static id check, and a manual browser pass.

- [ ] **Step 1: Add the section to `index.html`**

In `index.html`, insert this block between the `<p id="no-subwoofer-warning" ...>…</p>` element and the `<button id="download">` line:

```html
        <details id="measured-correction">
          <summary>Measured correction (optional)</summary>

          <h3>Apply a correction file</h3>
          <input type="file" id="correction-file-input" accept=".json,application/json" />
          <p id="correction-error" class="error" hidden></p>

          <div id="correction-loaded" hidden>
            <p id="correction-info"></p>
            <label>
              <input type="checkbox" id="correction-enabled" checked />
              Apply correction
            </label>
            <label>
              Cutoff (Hz)
              <input type="number" id="correction-cutoff" min="200" max="18000" step="100" value="2000" />
            </label>
            <table id="correction-summary">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Positions</th>
                  <th>Largest trim (dB)</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
            <p id="correction-notice" class="warning" hidden></p>
          </div>

          <details id="correction-generate">
            <summary>Generate a correction file</summary>
            <p class="hint">
              1. Pick the .ady you measured with. 2. Add the REW text exports for each speaker (about 3 positions
              each is plenty). 3. Generate.
            </p>
            <label>
              The .ady you measured with
              <input type="file" id="measured-ady-input" accept=".ady" />
            </label>
            <p id="generate-error" class="error" hidden></p>
            <div id="generate-rows"></div>
            <label>
              Label (optional)
              <input type="text" id="generate-label" placeholder="e.g. which mic" />
            </label>
            <button id="generate-button" disabled>Generate and download correction.json</button>
            <p id="generate-warnings" class="warning" hidden></p>
            <table id="generate-report" hidden>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Positions</th>
                  <th>Error RMS 2-20 kHz (dB)</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </details>
        </details>

```

- [ ] **Step 2: Add styles**

Append to `src/style.css`:

```css
details {
  margin: 1rem 0;
}

summary {
  cursor: pointer;
  font-weight: bold;
}

details details {
  margin-left: 1rem;
}

.hint {
  color: #aaa;
  font-size: 0.9rem;
}

.gen-row {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin: 0.25rem 0;
}

.gen-row .channel-name {
  min-width: 3.5rem;
  font-weight: bold;
}

#measured-correction label {
  display: block;
  margin: 0.5rem 0;
}
```

- [ ] **Step 3: Write `src/correctionUi.ts`**

Create `src/correctionUi.ts`:

```ts
import { isSubwooferChannel, parseAdy, type AdyFile } from './ady';
import {
  DEFAULT_CUTOFF_HZ,
  buildChannelTrims,
  parseCorrection,
  serializeCorrection,
  summarizeCorrection,
  type CorrectionFile,
} from './correction';
import type { TrimFn } from './curve';
import { REQUIRED_TARGET_CURVE_TYPE, generateCorrection, type GenerateResult, type SpeakerInput } from './generate';

export interface CorrectionUi {
  /** Tells the UI which channels the loaded base .ady has, for the summary table. */
  setBaseChannels(ids: string[]): void;
  /** Per-channel trims to apply on export, or undefined when none are loaded or applied. */
  getTrims(): ReadonlyMap<string, TrimFn> | undefined;
}

const MIN_CUTOFF_HZ = 200;
const MAX_CUTOFF_HZ = 18000;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
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

function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function initCorrectionUi(onChange: () => void): CorrectionUi {
  // apply-a-correction elements
  const fileInput = el<HTMLInputElement>('correction-file-input');
  const errorNode = el<HTMLElement>('correction-error');
  const loaded = el<HTMLElement>('correction-loaded');
  const info = el<HTMLElement>('correction-info');
  const enabled = el<HTMLInputElement>('correction-enabled');
  const cutoffInput = el<HTMLInputElement>('correction-cutoff');
  const summaryBody = document.querySelector('#correction-summary tbody') as HTMLElement;
  const notice = el<HTMLElement>('correction-notice');

  // generate elements
  const measuredInput = el<HTMLInputElement>('measured-ady-input');
  const generateError = el<HTMLElement>('generate-error');
  const rows = el<HTMLElement>('generate-rows');
  const labelInput = el<HTMLInputElement>('generate-label');
  const generateButton = el<HTMLButtonElement>('generate-button');
  const generateWarnings = el<HTMLElement>('generate-warnings');
  const reportTable = el<HTMLElement>('generate-report');
  const reportBody = document.querySelector('#generate-report tbody') as HTMLElement;

  let correction: CorrectionFile | null = null;
  let cutoffHz = DEFAULT_CUTOFF_HZ;
  let baseChannelIds: string[] = [];
  let measuredAdy: AdyFile | null = null;

  function renderApply(): void {
    if (!correction) {
      loaded.hidden = true;
      return;
    }
    loaded.hidden = false;
    info.textContent = `${correction.label || '(no label)'}, created ${correction.created}`;
    summaryBody.innerHTML = '';
    const summary = summarizeCorrection(correction, cutoffHz, baseChannelIds);
    for (const row of summary) {
      const tr = document.createElement('tr');
      tr.append(cell(row.commandId), cell(String(row.positions)), cell(row.maxAbsTrim.toFixed(2)));
      summaryBody.appendChild(tr);
    }
    const ignored = summary.filter((r) => !r.inBase).map((r) => r.commandId);
    show(notice, ignored.length > 0 ? `Not in the loaded .ady, so ignored: ${ignored.join(', ')}.` : null);
  }

  function rowInputs(): HTMLInputElement[] {
    return Array.from(rows.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  }

  function updateGenerateEnabled(): void {
    generateButton.disabled = measuredAdy === null || !rowInputs().some((i) => (i.files?.length ?? 0) > 0);
  }

  function buildRows(ady: AdyFile): void {
    rows.innerHTML = '';
    for (const channel of ady.detectedChannels) {
      if (isSubwooferChannel(channel)) continue;
      const row = document.createElement('div');
      row.className = 'gen-row';
      const name = document.createElement('span');
      name.className = 'channel-name';
      name.textContent = channel.commandId;
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.txt,.csv,.tsv,text/plain,text/csv';
      input.dataset.channel = channel.commandId;
      input.addEventListener('change', updateGenerateEnabled);
      row.append(name, input);
      rows.appendChild(row);
    }
  }

  function renderReport(result: GenerateResult): void {
    reportBody.innerHTML = '';
    for (const r of result.reports) {
      const tr = document.createElement('tr');
      tr.append(cell(r.commandId), cell(String(r.positions)), cell(r.rmsError.toFixed(2)));
      reportBody.appendChild(tr);
    }
    reportTable.hidden = false;
    show(generateWarnings, result.warnings.length > 0 ? result.warnings.join(' ') : null);
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      correction = parseCorrection(await file.text());
      show(errorNode, null);
    } catch (err) {
      correction = null;
      show(errorNode, (err as Error).message);
    }
    renderApply();
    onChange();
  });

  enabled.addEventListener('change', () => onChange());

  cutoffInput.addEventListener('input', () => {
    const value = Number(cutoffInput.value);
    if (Number.isFinite(value) && value >= MIN_CUTOFF_HZ && value <= MAX_CUTOFF_HZ) {
      cutoffHz = value;
      renderApply();
      onChange();
    }
  });

  measuredInput.addEventListener('change', async () => {
    const file = measuredInput.files?.[0];
    measuredAdy = null;
    rows.innerHTML = '';
    if (!file) {
      updateGenerateEnabled();
      return;
    }
    try {
      const parsed = parseAdy(await file.text());
      if (parsed.enTargetCurveType !== REQUIRED_TARGET_CURVE_TYPE) {
        throw new Error(
          `That .ady has enTargetCurveType ${parsed.enTargetCurveType}; it must be ${REQUIRED_TARGET_CURVE_TYPE} (the value this tool writes).`
        );
      }
      measuredAdy = parsed;
      show(generateError, null);
      buildRows(parsed);
    } catch (err) {
      show(generateError, (err as Error).message);
    }
    updateGenerateEnabled();
  });

  generateButton.addEventListener('click', async () => {
    generateButton.disabled = true;
    try {
      if (!measuredAdy) throw new Error('Pick the .ady you measured with first.');
      const speakers: SpeakerInput[] = [];
      for (const input of rowInputs()) {
        const files = Array.from(input.files ?? []);
        if (files.length === 0) continue;
        speakers.push({
          commandId: input.dataset.channel as string,
          files: await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))),
        });
      }
      const result = generateCorrection(measuredAdy, speakers, labelInput.value.trim());
      correction = result.correction;
      enabled.checked = true;
      downloadJson('correction.json', serializeCorrection(result.correction));
      show(generateError, null);
      renderReport(result);
      renderApply();
      onChange();
    } catch (err) {
      show(generateError, (err as Error).message);
    } finally {
      updateGenerateEnabled();
    }
  });

  return {
    setBaseChannels(ids: string[]): void {
      baseChannelIds = ids;
      renderApply();
    },
    getTrims(): ReadonlyMap<string, TrimFn> | undefined {
      if (!correction || !enabled.checked) return undefined;
      return buildChannelTrims(correction, cutoffHz);
    },
  };
}
```

- [ ] **Step 4: Wire it into `src/main.ts`**

Four edits.

(a) Replace the import block at the top:

```ts
import {
  parseAdy,
  isSubwooferChannel,
  applyCurveToAdy,
  serializeAdy,
  AdyValidationError,
  type AdyFile,
} from './ady';
import { createChart, updateChart } from './chart';
import { computeTrimShift, type CurveParams } from './curve';
```

with:

```ts
import {
  parseAdy,
  isSubwooferChannel,
  applyCurveToAdy,
  hasAppliedTrims,
  serializeAdy,
  AdyValidationError,
  type AdyFile,
} from './ady';
import { createChart, updateChart } from './chart';
import { initCorrectionUi } from './correctionUi';
import { computeTrimShift, type CurveParams } from './curve';
```

(b) Directly after the line `const downloadButton = document.getElementById('download') as HTMLButtonElement;` add:

```ts
const correctionUi = initCorrectionUi(() => onParamsChanged());
```

(c) In `loadFile`, directly after `currentAdy = parseAdy(text);` add:

```ts
      correctionUi.setBaseChannels(currentAdy.detectedChannels.map((c) => c.commandId));
```

(d) Replace the download handler body's first line and filename logic. The current code:

```ts
  const result = applyCurveToAdy(currentAdy, params);
```

becomes:

```ts
  const trims = correctionUi.getTrims();
  const result = applyCurveToAdy(currentAdy, params, trims);
```

and the current code:

```ts
  // distinct name so a no-cancel test file can't be mistaken for the normal one
  const suffix = params.cancelHfKnee === false ? '_no-knee-cancel' : '';
```

becomes:

```ts
  // distinct names so test variants can't be mistaken for the normal file
  const suffix =
    (params.cancelHfKnee === false ? '_no-knee-cancel' : '') +
    (hasAppliedTrims(currentAdy, trims) ? '_measured-trim' : '');
```

- [ ] **Step 5: Static checks and full suite**

Run the id check (prints nothing when every element the UI looks up exists in the HTML):

```bash
for id in $(grep -o "el<[A-Za-z]*>('[a-z-]*')" src/correctionUi.ts | sed "s/.*('\(.*\)')/\1/"); do grep -q "id=\"$id\"" index.html || echo "MISSING $id"; done
```

Expected: no output.

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add index.html src/style.css src/correctionUi.ts src/main.ts
git commit -m "$(cat <<'EOF'
feat: add the measured-correction section to the UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Manual browser verification (controller; needs browser tooling)**

An implementer without browser tools stops after Step 6 and reports DONE_WITH_CONCERNS saying this step still needs doing.

Start the dev server (`npm run dev -- --port 5173 --strictPort`), open `http://localhost:5173/`, and load a synthetic base `.ady` by injecting it (same technique as earlier browser checks). Then verify:

1. With no correction loaded, "Download corrected .ady" still gives `Sample_corrected.ady` and every channel has the same points.
2. Open "Measured correction" then "Generate a correction file". Load a synthetic measured `.ady` with `enTargetCurveType: 0`: the error message about type 2 appears and no rows show. Load one with `enTargetCurveType: 2`: rows appear for each non-sub channel only (no SW row) and Generate stays disabled.
3. Add a synthetic REW text file to one row: Generate becomes enabled. Click it: a `correction.json` download is triggered, the report table shows that channel with its position count and an RMS value, and the "Apply a correction file" part now shows the label/date, a summary row, and the "Apply correction" box ticked.
4. Change the cutoff: the "Largest trim" value changes. Untick "Apply correction": the export no longer differs between channels and has no `_measured-trim` suffix. Tick it again: the trimmed channel's points differ from an untrimmed channel's above ~2 kHz, and the filename ends `_corrected_measured-trim.ady`.
5. Load a correction file containing a channel the base `.ady` lacks: the "ignored" notice appears. Load a garbage file: an error message shows and the table hides.

Useful injection helpers (paste through the browser JS tool):

```js
function setFiles(input, files) {
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function rewText(fn) {
  let s = '';
  for (let i = 0; i < 1500; i++) {
    const f = 10 * 2000 ** (i / 1499);
    s += `${f.toFixed(4)}, ${fn(f).toFixed(4)}\n`;
  }
  return s;
}
```

Stop the dev server (`pkill -f "vite --port 5173"`) and delete any stray build output (`rm -f src/*.js tsconfig.tsbuildinfo`) when done.

---

### Task 10: Local acceptance check against real measurements

**Files:**
- Create: `scripts/acceptance.local.test.ts`

**Interfaces:**
- Consumes: `parseAdy`, `generateCorrection`, `buildChannelTrims`, `logGrid`.
- Produces: an opt-in test that is skipped unless `REAL_DATA_DIR` is set. `scripts/` is outside `tsconfig.json`'s `include`, so `tsc -b` does not type-check it (it uses Node APIs and there is no `@types/node`); Vitest still runs it. It contains no personal data, only loose bounds taken from the design spec's findings.

`REAL_DATA_DIR` must contain: the stock `Default.ady`, and `L.txt`, `R.txt`, `C.txt` (one REW RMS-average export per speaker, measured on the stock calibration).

- [ ] **Step 1: Write the test**

Create `scripts/acceptance.local.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAdy } from '../src/ady';
import { buildChannelTrims } from '../src/correction';
import { generateCorrection } from '../src/generate';
import { logGrid } from '../src/measuredError';

/**
 * Opt-in check against a real measurement session. Skipped unless REAL_DATA_DIR
 * points at a folder with Default.ady (stock calibration) and L.txt, R.txt, C.txt
 * (REW exports, one per speaker, measured on that stock calibration).
 *
 *   REAL_DATA_DIR=/path/to/folder npx vitest run scripts/acceptance.local.test.ts
 *
 * The bounds are loose on purpose: they encode the shape found in the design
 * spec (a dip near 4 kHz, a lift of ~1-2 dB from 6-10 kHz), not exact numbers.
 */
const dir = process.env.REAL_DATA_DIR;
const SPEAKERS: Record<string, string> = { L: 'FL', R: 'FR', C: 'C' };

function load() {
  const read = (name: string) => readFileSync(join(dir as string, name), 'utf8');
  const ady = parseAdy(read('Default.ady'));
  const speakers = Object.entries(SPEAKERS).map(([file, commandId]) => ({
    commandId,
    files: [{ name: `${file}.txt`, text: read(`${file}.txt`) }],
  }));
  return generateCorrection(ady, speakers, 'acceptance');
}

describe.skipIf(!dir)('local acceptance: real measurement session', () => {
  const grid = logGrid();
  const at = (values: number[], hz: number) => values[grid.findIndex((f) => f >= hz)];
  const meanBetween = (values: number[], lo: number, hi: number) => {
    const picked = values.filter((_, i) => grid[i] >= lo && grid[i] <= hi);
    return picked.reduce((a, b) => a + b, 0) / picked.length;
  };

  it('generates without warnings and with one position per speaker', () => {
    const { correction, warnings } = load();
    expect(warnings).toEqual([]);
    for (const id of Object.values(SPEAKERS)) expect(correction.channels[id].positions).toBe(1);
  });

  it('finds a dip near 4 kHz on every speaker', () => {
    const { correction } = load();
    for (const id of Object.values(SPEAKERS)) {
      const e = at(correction.channels[id].error, 4000);
      expect(e).toBeGreaterThan(-2.2);
      expect(e).toBeLessThan(-0.3);
    }
  });

  it('finds a lift between 6.3 and 10 kHz on every speaker', () => {
    const { correction } = load();
    for (const id of Object.values(SPEAKERS)) {
      const e = meanBetween(correction.channels[id].error, 6300, 10000);
      expect(e).toBeGreaterThan(0.5);
      expect(e).toBeLessThan(2.5);
    }
  });

  it('derives a cut of roughly 0.5-2.5 dB at 10 kHz with the default cutoff', () => {
    const { correction } = load();
    const trims = buildChannelTrims(correction, 2000);
    for (const id of Object.values(SPEAKERS)) {
      const t = trims.get(id)!(10000);
      expect(t).toBeLessThan(-0.5);
      expect(t).toBeGreaterThan(-2.5);
    }
  });
});
```

- [ ] **Step 2: Confirm it is skipped without the variable**

Run: `npm test`
Expected: all tests pass, and the acceptance suite is reported as skipped (its tests do not run).

- [ ] **Step 3: Run it against the real data (controller, locally)**

Run: `REAL_DATA_DIR=/Users/esben/Downloads npx vitest run scripts/acceptance.local.test.ts`
Expected: 4 passed. If a bound fails, report the actual value: it points either at a bug in the pipeline or at a bound that was set too tightly, and the human decides which.

- [ ] **Step 4: Confirm the build still ignores it**

Run: `npm run build`
Expected: succeeds (the `scripts/` folder is not type-checked).

- [ ] **Step 5: Commit**

```bash
git add scripts/acceptance.local.test.ts
git commit -m "$(cat <<'EOF'
test: add an opt-in acceptance check against real measurements

Skipped unless REAL_DATA_DIR is set; contains no personal data.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** REW parsing incl. 2/3 columns, comments, coverage rejection (Task 2); grid, 1/6-oct power smoothing, position averaging, normalisation band, differing grids (Task 3); effective target = written + knee, stock = knee alone, `E` (Task 4); file schema and every validation rule (Task 5); 1-octave smoothing, ±3 dB clamp, 1-octave fade around the cutoff, negate, summary rows, ignored-channel flag (Task 6); per-channel export, sub and unmeasured channels untouched, byte-identical with no correction, `_measured-trim` only when something changed (Tasks 7 and 9); type-2 refusal, empty/duplicate/sub/unknown channel, 4 dB warning, parse errors naming the file (Task 8); UI: apply panel with cutoff/checkbox/table/notice, generate panel with per-channel rows, label, report, auto-load of the generated file (Task 9); local acceptance (Task 10). `correction*.json` is already gitignored by the spec commit.
- **Placeholders:** none; every code step is complete.
- **Type consistency:** `TrimFn` (curve.ts) is used by correction.ts, ady.ts and correctionUi.ts; `logGrid`, `smoothToGrid`, `averagePositions`, `normalizeLevel`, `rmsOver`, `effectiveTarget`, `computeError` keep one signature from definition to use; `CorrectionFile`/`CorrectionChannel` are defined in Task 5 and used unchanged in Tasks 6, 8, 9; `generateCorrection` and `SpeakerInput`/`GenerateResult` match between Tasks 8, 9 and 10.
- **Known limits:** the acceptance check maps only L/R/C (FL/FR/C); the rear speakers' channel ids were not verified.

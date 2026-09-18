# Target Curve Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, client-side GitHub Pages web app that loads an Audyssey `.ady` file, lets the user design a target curve (down-tilt + optional smooth bass shelf), and downloads a modified `.ady` with that curve applied to every channel — compensating for Audyssey's fixed HF double-knee and its subwoofer-only level renormalization.

**Architecture:** TypeScript + Vite, no UI framework. Pure, unit-tested math modules (`hfKnee.ts`, `curve.ts`, `ady.ts`) underneath a thin DOM-wiring layer (`main.ts`, `chart.ts`) that is verified manually in-browser. Built `dist/` deployed to GitHub Pages via GitHub Actions.

**Tech Stack:** TypeScript, Vite, Vitest, uPlot (charting). No framework, no server, no backend.

## Global Constraints

- Static, fully client-side — no server, no file leaves the browser.
- Repo is public — real `.ady` files (personal calibration data) are gitignored (`*.ady`) and must never be used as committed test fixtures; use the synthetic fixture instead.
- Subwoofer channels are identified by `commandId` starting with `"SW"` — never assume a fixed channel count or index.
- `enTargetCurveType` must be forced to `2` in all output files, regardless of the input value.
- Frequency grid for `customTargetCurvePoints`: 1Hz steps 20–200Hz, 10Hz steps 200–20000Hz, always ending exactly at 20000.
- Tilt pivot is fixed at 1000Hz (0dB). Bass shelf knee softness is a fixed internal constant, not user-exposed.
- No automated UI/e2e tests for v1 — DOM-facing code is verified manually in-browser.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/smoke.test.ts`

**Interfaces:**
- Produces: a working `npm run dev` / `npm run build` / `npm test` toolchain that every later task builds on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "target-curve-editor",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "uplot": "^1.6.31"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes without error, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  // relative base so the built app works from any GitHub Pages project path
  // without hardcoding the repo name
  base: './',
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Audyssey Target Curve Editor</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/main.ts` placeholder**

```ts
console.log('Target Curve Editor loaded');
```

- [ ] **Step 7: Create `src/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('project scaffolding', () => {
  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Run tests to verify tooling works**

Run: `npm test`
Expected: `1 passed` (the smoke test).

- [ ] **Step 9: Run build to verify tooling works**

Run: `npm run build`
Expected: completes without error, creates `dist/index.html` and `dist/assets/`.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src/main.ts src/smoke.test.ts
git commit -m "chore: scaffold Vite + TypeScript + Vitest project"
```

---

### Task 2: HF-knee model (`hfKnee.ts`)

**Files:**
- Create: `src/hfKnee.ts`
- Create: `src/hfKnee.test.ts`

**Interfaces:**
- Produces: `hfKneeGain(freq: number): number` — dB gain of Audyssey's fixed HF double-knee rolloff at a given frequency (Hz). Consumed by `curve.ts` (Task 5).

- [ ] **Step 1: Write the failing tests**

Create `src/hfKnee.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hfKneeGain } from './hfKnee';

describe('hfKneeGain', () => {
  it('is ~0dB well below the knee (100Hz)', () => {
    expect(hfKneeGain(100)).toBeCloseTo(0, 3);
  });

  it('is ~0dB at 1kHz (flat midrange)', () => {
    expect(hfKneeGain(1000)).toBeCloseTo(0, 3);
  });

  it('is ~-0.591dB at 5kHz', () => {
    expect(hfKneeGain(5000)).toBeCloseTo(-0.5915, 3);
  });

  it('is ~-3.416dB at 10kHz', () => {
    expect(hfKneeGain(10000)).toBeCloseTo(-3.4156, 3);
  });

  it('is ~-5.944dB at 20kHz', () => {
    expect(hfKneeGain(20000)).toBeCloseTo(-5.9444, 3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hfKnee.test.ts`
Expected: FAIL with "Failed to resolve import './hfKnee'" (module doesn't exist yet).

- [ ] **Step 3: Create `src/hfKnee.ts`**

```ts
/**
 * Audyssey MultEQ's default HF double-knee rolloff (enTargetCurveType === 2),
 * fitted once from a reference target-curve screenshot. See
 * docs/superpowers/specs/2026-09-18-target-curve-editor-design.md for
 * derivation. Ported from hf_knee.py.
 *
 * gain(f) = G1 * r1/(1+r1) + G2 * r2/(1+r2),  ri = (f / f0i) ** ni
 * Fit quality against the extracted curve: RMS 0.032 dB, max error 0.16 dB.
 */

const G1 = -2.9865;
const F01 = 6352.62;
const N1 = 6.4001;

const G2 = -5.0943;
const F02 = 18176.89;
const N2 = 3.4201;

function shelf(freq: number, gain: number, f0: number, n: number): number {
  const ratio = (freq / f0) ** n;
  return (gain * ratio) / (1 + ratio);
}

/** dB gain of Audyssey's default HF double-knee rolloff at `freq` (Hz). */
export function hfKneeGain(freq: number): number {
  return shelf(freq, G1, F01, N1) + shelf(freq, G2, F02, N2);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hfKnee.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/hfKnee.ts src/hfKnee.test.ts
git commit -m "feat: port fitted HF-knee model to TypeScript"
```

---

### Task 3: Tilt and frequency grid (`curve.ts` part 1)

**Files:**
- Create: `src/curve.ts`
- Create: `src/curve.test.ts`

**Interfaces:**
- Produces: `tilt(freq: number, slope: number): number`, `frequencyGrid(): number[]`. Consumed by Task 4 (designGain), Task 5 (writtenGain/computeTrimShift), Task 7 (applyCurveToAdy).

- [ ] **Step 1: Write the failing tests**

Create `src/curve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tilt, frequencyGrid } from './curve';

describe('tilt', () => {
  it('is 0dB at the 1kHz pivot regardless of slope', () => {
    expect(tilt(1000, 6)).toBeCloseTo(0, 6);
    expect(tilt(1000, -3)).toBeCloseTo(0, 6);
  });

  it('boosts below the pivot for positive slope', () => {
    expect(tilt(500, 6)).toBeCloseTo(6, 6);
  });

  it('cuts above the pivot for positive slope', () => {
    expect(tilt(2000, 6)).toBeCloseTo(-6, 6);
  });
});

describe('frequencyGrid', () => {
  it('starts at 20Hz and ends at exactly 20000Hz', () => {
    const grid = frequencyGrid();
    expect(grid[0]).toBe(20);
    expect(grid[grid.length - 1]).toBe(20000);
  });

  it('uses 1Hz steps below 200Hz and 10Hz steps above', () => {
    const grid = frequencyGrid();
    expect(grid[1] - grid[0]).toBe(1);
    const idx200 = grid.indexOf(200);
    expect(grid[idx200 + 1] - grid[idx200]).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/curve.test.ts`
Expected: FAIL with "Failed to resolve import './curve'" (module doesn't exist yet).

- [ ] **Step 3: Create `src/curve.ts`**

```ts
const PIVOT_FREQ = 1000;

/** Down-tilt gain in dB at `freq`, `slope` dB/octave, 0dB at 1kHz. */
export function tilt(freq: number, slope: number): number {
  return slope * Math.log2(PIVOT_FREQ / freq);
}

/**
 * Frequency grid matching the original Python scripts: 1Hz steps from
 * 20-200Hz, 10Hz steps from 200-20000Hz, always ending exactly at 20000.
 */
export function frequencyGrid(): number[] {
  const grid: number[] = [];
  for (let f = 20; f < 200; f += 1) grid.push(f);
  for (let f = 200; f < 20000; f += 10) grid.push(f);
  if (grid[grid.length - 1] !== 20000) grid.push(20000);
  return grid;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/curve.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/curve.ts src/curve.test.ts
git commit -m "feat: add tilt and frequency grid functions"
```

---

### Task 4: Smooth bass shelf (`curve.ts` part 2)

**Files:**
- Modify: `src/curve.ts` (append)
- Modify: `src/curve.test.ts` (append)

**Interfaces:**
- Consumes: `tilt` (Task 3)
- Produces: `CurveParams` interface, `designGain(freq: number, params: CurveParams): number`. Consumed by Task 5 (writtenGain/computeTrimShift), Task 7 (applyCurveToAdy via writtenGain), Task 8 (chart.ts), Task 9 (main.ts).

- [ ] **Step 1: Write the failing tests**

Append to `src/curve.test.ts`:

```ts
import { designGain, type CurveParams } from './curve';

describe('designGain', () => {
  it('equals tilt exactly when the shelf is disabled', () => {
    const params: CurveParams = { slope: 4, shelfEnabled: false, shelfGain: 0 };
    expect(designGain(300, params)).toBeCloseTo(tilt(300, 4), 9);
  });

  it('is close to 0dB at the pivot, barely nudged by a shelf far below it', () => {
    // slope=6, shelfGain=6 -> tilt(f)=shelfGain at f=500Hz, well below the 1kHz pivot
    const params: CurveParams = { slope: 6, shelfEnabled: true, shelfGain: 6 };
    expect(designGain(1000, params)).toBeCloseTo(-0.0272, 3);
  });

  it('sits slightly below shelfGain right at the tilt/shelf crossing frequency', () => {
    // tilt(500, 6) === 6 === shelfGain, so this is exactly the crossing point
    const params: CurveParams = { slope: 6, shelfEnabled: true, shelfGain: 6 };
    expect(designGain(500, params)).toBeCloseTo(4.9603, 3);
  });

  it('asymptotically approaches shelfGain well below the crossing frequency', () => {
    const params: CurveParams = { slope: 6, shelfEnabled: true, shelfGain: 6 };
    expect(designGain(100, params)).toBeCloseTo(6.0, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/curve.test.ts`
Expected: FAIL — `designGain` and `CurveParams` are not exported yet.

- [ ] **Step 3: Append to `src/curve.ts`**

```ts
/** Fixed knee-width (octaves) for the smooth tilt->shelf transition. Not user-exposed. */
const SHELF_KNEE_OCTAVES = 0.5;

export interface CurveParams {
  /** dB/octave. Positive tilts down toward treble, up toward bass. */
  slope: number;
  shelfEnabled: boolean;
  /** dB ceiling the bass shelf caps the tilt at. Only used when shelfEnabled. */
  shelfGain: number;
}

function softmin(a: number, b: number, k: number): number {
  return (-1 / k) * Math.log(Math.exp(-k * a) + Math.exp(-k * b));
}

/**
 * The curve you're designing: down-tilt, optionally capped by a smooth
 * bass shelf. This is what the live preview chart plots. Assumes a
 * positive slope when the shelf is enabled (a shelf only makes sense as a
 * cap on a rising-toward-bass tilt).
 */
export function designGain(freq: number, params: CurveParams): number {
  const t = tilt(freq, params.slope);
  if (!params.shelfEnabled) return t;
  const k = 2 / (params.slope * SHELF_KNEE_OCTAVES);
  return softmin(t, params.shelfGain, k);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/curve.test.ts`
Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/curve.ts src/curve.test.ts
git commit -m "feat: add smooth tilt-to-shelf design curve"
```

---

### Task 5: HF-knee cancellation and trim shift (`curve.ts` part 3)

**Files:**
- Modify: `src/curve.ts` (append)
- Modify: `src/curve.test.ts` (append)

**Interfaces:**
- Consumes: `designGain`, `frequencyGrid`, `CurveParams` (this file), `hfKneeGain` (Task 2, `./hfKnee`)
- Produces: `writtenGain(freq: number, params: CurveParams): number`, `computeTrimShift(params: CurveParams): number`. Consumed by Task 7 (`applyCurveToAdy`), Task 9 (`main.ts` channel summary).

- [ ] **Step 1: Write the failing tests**

Append to `src/curve.test.ts`:

```ts
import { writtenGain, computeTrimShift } from './curve';
import { hfKneeGain } from './hfKnee';

describe('writtenGain', () => {
  it('equals designGain minus the HF knee at a point where the knee is non-zero', () => {
    const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };
    const expected = designGain(10000, params) - hfKneeGain(10000);
    expect(writtenGain(10000, params)).toBeCloseTo(expected, 9);
  });

  it('is unaffected by the HF knee well below the knee (100Hz)', () => {
    const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };
    expect(writtenGain(100, params)).toBeCloseTo(designGain(100, params), 3);
  });
});

describe('computeTrimShift', () => {
  it('is the writtenGain value at 20Hz for a positive-slope, shelf-disabled curve', () => {
    // the curve is monotonically decreasing with frequency in this case, so the
    // max over the grid is at its lowest point, 20Hz
    const params: CurveParams = { slope: 6, shelfEnabled: false, shelfGain: 0 };
    const expected = writtenGain(20, params);
    expect(computeTrimShift(params)).toBeCloseTo(expected, 6);
  });

  it('is close to shelfGain when the shelf is enabled and caps the bass boost', () => {
    const params: CurveParams = { slope: 6, shelfEnabled: true, shelfGain: 6 };
    expect(computeTrimShift(params)).toBeCloseTo(6, 2);
  });

  it('equals the negative of the HF knee minimum when slope is 0 (flat design, pure knee cancellation)', () => {
    const params: CurveParams = { slope: 0, shelfEnabled: false, shelfGain: 0 };
    expect(computeTrimShift(params)).toBeCloseTo(5.9444, 3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/curve.test.ts`
Expected: FAIL — `writtenGain` and `computeTrimShift` are not exported yet.

- [ ] **Step 3: Append to `src/curve.ts`**

```ts
import { hfKneeGain } from './hfKnee';

/**
 * The curve actually written to the .ady file: the designed curve with
 * Audyssey's fixed HF-knee rolloff pre-cancelled, so what you designed is
 * what you actually get after Audyssey applies its own knee on top.
 */
export function writtenGain(freq: number, params: CurveParams): number {
  return designGain(freq, params) - hfKneeGain(freq);
}

/**
 * The amount Audyssey will shift a subwoofer's curve down to normalize its
 * max to 0dB -- and therefore the trim boost needed to restore the
 * absolute level you designed.
 */
export function computeTrimShift(params: CurveParams): number {
  const grid = frequencyGrid();
  let max = -Infinity;
  for (const f of grid) {
    const g = writtenGain(f, params);
    if (g > max) max = g;
  }
  return max;
}
```

Note: add the `import { hfKneeGain } from './hfKnee';` line at the top of `src/curve.ts`, alongside any existing imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/curve.test.ts`
Expected: `14 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/curve.ts src/curve.test.ts
git commit -m "feat: add HF-knee cancellation and subwoofer trim shift calculation"
```

---

### Task 6: `.ady` parsing, validation, and synthetic fixture

**Files:**
- Create: `src/ady.ts`
- Create: `src/fixtures/sampleAdy.ts`
- Create: `src/ady.test.ts`

**Interfaces:**
- Produces: `AdyChannel`, `AdyFile` interfaces; `AdyValidationError` class; `parseAdy(jsonText: string): AdyFile`; `isSubwooferChannel(channel: AdyChannel): boolean`. Consumed by Task 7 (`applyCurveToAdy`, `serializeAdy`), Task 9 (`main.ts`).
- Produces (fixture): `createSampleAdy(): AdyFile`. Consumed by Task 7's tests and this task's own tests.

- [ ] **Step 1: Write the failing tests**

Create `src/fixtures/sampleAdy.ts` first (the fixture, not a test, but needed for the tests below):

```ts
import type { AdyFile } from '../ady';

/**
 * Small synthetic .ady fixture for tests -- structurally matches a real
 * file (a non-sub channel, a subwoofer channel, dummy responseData) but
 * contains no real calibration data. Real .ady files are gitignored and
 * must never be used as a committed test fixture.
 */
export function createSampleAdy(): AdyFile {
  return {
    title: 'Sample',
    enTargetCurveType: 0,
    detectedChannels: [
      {
        commandId: 'FL',
        customTargetCurvePoints: [],
        trimAdjustment: '0.500000',
        customSpeakerType: 'S',
        responseData: { 0: [1, 2, 3] },
      },
      {
        commandId: 'SW1',
        customTargetCurvePoints: [],
        trimAdjustment: '-1.250000',
        customSpeakerType: 'S',
        responseData: { 0: [4, 5, 6] },
      },
    ],
  };
}
```

Create `src/ady.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAdy, isSubwooferChannel, AdyValidationError } from './ady';
import { createSampleAdy } from './fixtures/sampleAdy';

describe('parseAdy', () => {
  it('parses a valid sample file', () => {
    const json = JSON.stringify(createSampleAdy());
    const parsed = parseAdy(json);
    expect(parsed.detectedChannels).toHaveLength(2);
    expect(parsed.enTargetCurveType).toBe(0);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseAdy('{not json')).toThrow(AdyValidationError);
  });

  it('rejects a file missing detectedChannels', () => {
    expect(() => parseAdy(JSON.stringify({ enTargetCurveType: 0 }))).toThrow(AdyValidationError);
  });

  it('rejects an empty detectedChannels array', () => {
    expect(() => parseAdy(JSON.stringify({ enTargetCurveType: 0, detectedChannels: [] }))).toThrow(
      AdyValidationError
    );
  });

  it('rejects a channel missing commandId', () => {
    const bad = createSampleAdy();
    // @ts-expect-error deliberately breaking the fixture for this test
    delete bad.detectedChannels[0].commandId;
    expect(() => parseAdy(JSON.stringify(bad))).toThrow(AdyValidationError);
  });

  it('rejects a missing enTargetCurveType', () => {
    const bad = createSampleAdy();
    // @ts-expect-error deliberately breaking the fixture for this test
    delete bad.enTargetCurveType;
    expect(() => parseAdy(JSON.stringify(bad))).toThrow(AdyValidationError);
  });
});

describe('isSubwooferChannel', () => {
  it('treats commandId starting with SW as a subwoofer', () => {
    const ady = createSampleAdy();
    expect(isSubwooferChannel(ady.detectedChannels[1])).toBe(true);
  });

  it('does not treat other commandIds as a subwoofer', () => {
    const ady = createSampleAdy();
    expect(isSubwooferChannel(ady.detectedChannels[0])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ady.test.ts`
Expected: FAIL — `./ady` module doesn't exist yet.

- [ ] **Step 3: Create `src/ady.ts`**

```ts
export interface AdyChannel {
  commandId: string;
  customTargetCurvePoints: string[];
  trimAdjustment: string;
  [key: string]: unknown;
}

export interface AdyFile {
  enTargetCurveType: number;
  detectedChannels: AdyChannel[];
  [key: string]: unknown;
}

export class AdyValidationError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateChannel(channel: unknown, index: number): asserts channel is AdyChannel {
  if (!isPlainObject(channel)) {
    throw new AdyValidationError(`detectedChannels[${index}] is not an object`);
  }
  if (typeof channel.commandId !== 'string') {
    throw new AdyValidationError(`detectedChannels[${index}].commandId is missing or not a string`);
  }
  if (!Array.isArray(channel.customTargetCurvePoints)) {
    throw new AdyValidationError(
      `detectedChannels[${index}].customTargetCurvePoints is missing or not an array`
    );
  }
  if (typeof channel.trimAdjustment !== 'string') {
    throw new AdyValidationError(`detectedChannels[${index}].trimAdjustment is missing or not a string`);
  }
}

/** Parses and validates a .ady file's JSON text. Throws AdyValidationError on any structural mismatch. */
export function parseAdy(jsonText: string): AdyFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new AdyValidationError(`Not valid JSON: ${(err as Error).message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new AdyValidationError('Top level of the file is not an object');
  }
  if (typeof parsed.enTargetCurveType !== 'number') {
    throw new AdyValidationError('Missing or non-numeric enTargetCurveType');
  }
  if (!Array.isArray(parsed.detectedChannels) || parsed.detectedChannels.length === 0) {
    throw new AdyValidationError('Missing or empty detectedChannels array');
  }
  parsed.detectedChannels.forEach((channel, i) => validateChannel(channel, i));

  return parsed as AdyFile;
}

/** A channel is treated as a subwoofer if its commandId starts with "SW" (e.g. SW1, SW2). */
export function isSubwooferChannel(channel: AdyChannel): boolean {
  return channel.commandId.startsWith('SW');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ady.test.ts`
Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/ady.ts src/ady.test.ts src/fixtures/sampleAdy.ts
git commit -m "feat: add .ady parsing, validation, and subwoofer detection"
```

---

### Task 7: Applying the curve to a file (`ady.ts` part 2)

**Files:**
- Modify: `src/ady.ts` (append)
- Modify: `src/ady.test.ts` (append)

**Interfaces:**
- Consumes: `AdyFile`, `isSubwooferChannel`, `parseAdy` (this file); `CurveParams`, `frequencyGrid`, `writtenGain`, `computeTrimShift` (Task 3/4/5, `./curve`)
- Produces: `applyCurveToAdy(ady: AdyFile, params: CurveParams): AdyFile`, `serializeAdy(ady: AdyFile): string`. Consumed by Task 9 (`main.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `src/ady.test.ts`:

```ts
import { applyCurveToAdy, serializeAdy } from './ady';
import { computeTrimShift, frequencyGrid, type CurveParams } from './curve';

describe('applyCurveToAdy', () => {
  const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };

  it('writes the same customTargetCurvePoints to every channel', () => {
    const result = applyCurveToAdy(createSampleAdy(), params);
    expect(result.detectedChannels[0].customTargetCurvePoints).toEqual(
      result.detectedChannels[1].customTargetCurvePoints
    );
    expect(result.detectedChannels[0].customTargetCurvePoints.length).toBe(frequencyGrid().length);
  });

  it('adds the trim shift only to the subwoofer channel', () => {
    const result = applyCurveToAdy(createSampleAdy(), params);
    const trimShift = computeTrimShift(params);
    expect(parseFloat(result.detectedChannels[1].trimAdjustment)).toBeCloseTo(-1.25 + trimShift, 5);
    expect(result.detectedChannels[0].trimAdjustment).toBe('0.500000');
  });

  it('forces enTargetCurveType to 2', () => {
    const result = applyCurveToAdy(createSampleAdy(), params);
    expect(result.enTargetCurveType).toBe(2);
  });

  it('does not mutate the input', () => {
    const input = createSampleAdy();
    applyCurveToAdy(input, params);
    expect(input.detectedChannels[0].customTargetCurvePoints).toEqual([]);
    expect(input.enTargetCurveType).toBe(0);
  });

  it('preserves unrelated fields', () => {
    const result = applyCurveToAdy(createSampleAdy(), params);
    expect(result.detectedChannels[0].responseData).toEqual({ 0: [1, 2, 3] });
    expect(result.title).toBe('Sample');
  });
});

describe('serializeAdy', () => {
  it('round-trips through parseAdy', () => {
    const original = createSampleAdy();
    const text = serializeAdy(original);
    const reparsed = parseAdy(text);
    expect(reparsed).toEqual(original);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ady.test.ts`
Expected: FAIL — `applyCurveToAdy` and `serializeAdy` are not exported yet.

- [ ] **Step 3: Append to `src/ady.ts`**

```ts
import { frequencyGrid, writtenGain, computeTrimShift, type CurveParams } from './curve';

const FORCED_TARGET_CURVE_TYPE = 2;

function formatPoint(freq: number, gain: number): string {
  return `{${freq.toFixed(1)}, ${gain.toFixed(3)}}`;
}

/**
 * Returns a new AdyFile with the designed curve written to every channel,
 * subwoofer trim compensated, and enTargetCurveType forced to the value
 * that matches the modeled HF knee. Does not mutate the input.
 */
export function applyCurveToAdy(ady: AdyFile, params: CurveParams): AdyFile {
  const clone = JSON.parse(JSON.stringify(ady)) as AdyFile;
  const grid = frequencyGrid();
  const points = grid.map((f) => formatPoint(f, writtenGain(f, params)));
  const trimShift = computeTrimShift(params);

  for (const channel of clone.detectedChannels) {
    channel.customTargetCurvePoints = points;
    if (isSubwooferChannel(channel)) {
      const originalTrim = parseFloat(channel.trimAdjustment);
      channel.trimAdjustment = (originalTrim + trimShift).toFixed(6);
    }
  }

  clone.enTargetCurveType = FORCED_TARGET_CURVE_TYPE;
  return clone;
}

export function serializeAdy(ady: AdyFile): string {
  return JSON.stringify(ady);
}
```

Note: add the `import { frequencyGrid, writtenGain, computeTrimShift, type CurveParams } from './curve';` line at the top of `src/ady.ts`, alongside the existing code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ady.test.ts`
Expected: `14 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/ady.ts src/ady.test.ts
git commit -m "feat: apply the designed curve to an .ady file"
```

---

### Task 8: Chart data and rendering (`chart.ts`)

**Files:**
- Create: `src/chart.ts`
- Create: `src/chart.test.ts`

**Interfaces:**
- Consumes: `designGain`, `CurveParams` (Task 4, `./curve`)
- Produces: `chartFrequencies(): number[]`, `designCurveData(params: CurveParams): [number[], number[]]`, `createChart(container: HTMLElement, params: CurveParams): uPlot`, `updateChart(chart: uPlot, params: CurveParams): void`. Consumed by Task 9 (`main.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/chart.test.ts` (only the pure data functions are tested here — `createChart`/`updateChart` need a real DOM and are verified manually in Task 9):

```ts
import { describe, it, expect } from 'vitest';
import { chartFrequencies, designCurveData } from './chart';
import type { CurveParams } from './curve';

describe('chartFrequencies', () => {
  it('spans 20Hz to 20000Hz', () => {
    const freqs = chartFrequencies();
    expect(freqs[0]).toBeCloseTo(20, 6);
    expect(freqs[freqs.length - 1]).toBeCloseTo(20000, 1);
  });

  it('is log-spaced (equal ratios between consecutive points)', () => {
    const freqs = chartFrequencies();
    const ratio1 = freqs[1] / freqs[0];
    const ratio2 = freqs[freqs.length - 1] / freqs[freqs.length - 2];
    expect(ratio1).toBeCloseTo(ratio2, 3);
  });
});

describe('designCurveData', () => {
  it('returns matching-length frequency and gain arrays', () => {
    const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };
    const [freqs, gains] = designCurveData(params);
    expect(freqs.length).toBe(gains.length);
  });

  it('gain near 1kHz is close to 0 for a pure tilt', () => {
    const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };
    const [freqs, gains] = designCurveData(params);
    let nearestIdx = 0;
    let nearestDist = Infinity;
    freqs.forEach((f, i) => {
      const dist = Math.abs(f - 1000);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    });
    expect(gains[nearestIdx]).toBeCloseTo(0, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/chart.test.ts`
Expected: FAIL — `./chart` module doesn't exist yet.

- [ ] **Step 3: Create `src/chart.ts`**

```ts
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { designGain, type CurveParams } from './curve';

/** Log-spaced sample points for a smooth chart line, independent of the .ady write grid. */
export function chartFrequencies(): number[] {
  const points = 400;
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const freqs: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    freqs.push(10 ** (minLog + t * (maxLog - minLog)));
  }
  return freqs;
}

/** Transforms curve params into [frequencies, gains] for the live preview chart. */
export function designCurveData(params: CurveParams): [number[], number[]] {
  const freqs = chartFrequencies();
  const gains = freqs.map((f) => designGain(f, params));
  return [freqs, gains];
}

export function createChart(container: HTMLElement, params: CurveParams): uPlot {
  const opts: uPlot.Options = {
    title: 'Target Curve',
    width: container.clientWidth || 800,
    height: 400,
    scales: {
      x: { distr: 3, min: 20, max: 20000 },
      y: { range: [-30, 20] },
    },
    axes: [{ label: 'Frequency (Hz)' }, { label: 'Gain (dB)' }],
    series: [{}, { label: 'Target Curve', stroke: '#e33', width: 2 }],
  };
  return new uPlot(opts, designCurveData(params) as uPlot.AlignedData, container);
}

export function updateChart(chart: uPlot, params: CurveParams): void {
  chart.setData(designCurveData(params) as uPlot.AlignedData);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/chart.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/chart.ts src/chart.test.ts
git commit -m "feat: add live target curve chart"
```

---

### Task 9: UI wiring (`main.ts`, `index.html`, `style.css`)

**Files:**
- Modify: `index.html`
- Create: `src/style.css`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `parseAdy`, `isSubwooferChannel`, `applyCurveToAdy`, `serializeAdy`, `AdyValidationError`, `AdyFile` (Task 6/7, `./ady`); `computeTrimShift`, `CurveParams` (Task 5, `./curve`); `createChart`, `updateChart` (Task 8, `./chart`)
- Produces: the working end-to-end app. Nothing downstream consumes this — it's the final integration point.

- [ ] **Step 1: Replace `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Audyssey Target Curve Editor</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div id="app">
      <h1>Audyssey Target Curve Editor</h1>

      <section id="dropzone">
        <p>Drag and drop a .ady file here, or click to choose one.</p>
        <input type="file" id="file-input" accept=".ady" />
      </section>

      <p id="error-message" class="error" hidden></p>

      <section id="editor" hidden>
        <div id="controls">
          <label>
            Slope (dB/octave)
            <input type="range" id="slope" min="0" max="10" step="0.1" value="3" />
            <input type="number" id="slope-number" min="0" max="10" step="0.1" value="3" />
          </label>

          <label>
            <input type="checkbox" id="shelf-enabled" />
            Bass shelf
          </label>

          <label>
            Shelf gain (dB)
            <input type="range" id="shelf-gain" min="-6" max="12" step="0.5" value="6" disabled />
            <input type="number" id="shelf-gain-number" min="-6" max="12" step="0.5" value="6" disabled />
          </label>
        </div>

        <div id="chart"></div>

        <table id="channel-summary">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Role</th>
              <th>Trim shift (dB)</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <p id="no-subwoofer-warning" class="warning" hidden>
          No subwoofer channel detected — trim compensation was skipped.
        </p>

        <button id="download">Download corrected .ady</button>
      </section>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/style.css`**

```css
body {
  font-family: system-ui, sans-serif;
  max-width: 800px;
  margin: 2rem auto;
  padding: 0 1rem;
  background: #111;
  color: #eee;
}

#dropzone {
  border: 2px dashed #555;
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
  margin-bottom: 1rem;
}

.error {
  color: #f66;
  font-weight: bold;
}

.warning {
  color: #fc6;
}

#controls label {
  display: block;
  margin-bottom: 0.75rem;
}

#chart {
  margin: 1rem 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1rem;
}

th,
td {
  text-align: left;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid #333;
}

button {
  font-size: 1rem;
  padding: 0.5rem 1rem;
}
```

- [ ] **Step 3: Replace `src/main.ts`**

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

let currentAdy: AdyFile | null = null;
let chart: ReturnType<typeof createChart> | null = null;

const params: CurveParams = {
  slope: 3,
  shelfEnabled: false,
  shelfGain: 6,
};

const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const errorMessage = document.getElementById('error-message') as HTMLElement;
const editor = document.getElementById('editor') as HTMLElement;
const chartContainer = document.getElementById('chart') as HTMLElement;
const slopeRange = document.getElementById('slope') as HTMLInputElement;
const slopeNumber = document.getElementById('slope-number') as HTMLInputElement;
const shelfEnabledInput = document.getElementById('shelf-enabled') as HTMLInputElement;
const shelfGainRange = document.getElementById('shelf-gain') as HTMLInputElement;
const shelfGainNumber = document.getElementById('shelf-gain-number') as HTMLInputElement;
const channelSummaryBody = document.querySelector('#channel-summary tbody') as HTMLElement;
const noSubwooferWarning = document.getElementById('no-subwoofer-warning') as HTMLElement;
const downloadButton = document.getElementById('download') as HTMLButtonElement;

function showError(message: string): void {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  editor.hidden = true;
}

function clearError(): void {
  errorMessage.hidden = true;
}

function loadFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    try {
      currentAdy = parseAdy(text);
      clearError();
      editor.hidden = false;
      renderChannelSummary();
      if (!chart) {
        chart = createChart(chartContainer, params);
      } else {
        updateChart(chart, params);
      }
    } catch (err) {
      currentAdy = null;
      if (err instanceof AdyValidationError) {
        showError(`Not a valid .ady file: ${err.message}`);
      } else {
        showError(`Could not read file: ${(err as Error).message}`);
      }
    }
  };
  reader.onerror = () => showError('Could not read file.');
  reader.readAsText(file);
}

function renderChannelSummary(): void {
  if (!currentAdy) return;
  channelSummaryBody.innerHTML = '';
  const trimShift = computeTrimShift(params);
  let anySubwoofer = false;

  for (const channel of currentAdy.detectedChannels) {
    const isSub = isSubwooferChannel(channel);
    if (isSub) anySubwoofer = true;
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = channel.commandId;
    row.appendChild(nameCell);

    const roleCell = document.createElement('td');
    roleCell.textContent = isSub ? 'Subwoofer' : 'Speaker';
    row.appendChild(roleCell);

    const trimCell = document.createElement('td');
    trimCell.textContent = isSub ? trimShift.toFixed(2) : '—';
    row.appendChild(trimCell);

    channelSummaryBody.appendChild(row);
  }

  noSubwooferWarning.hidden = anySubwoofer;
}

function onParamsChanged(): void {
  if (chart) updateChart(chart, params);
  if (currentAdy) renderChannelSummary();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
});

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

function syncPair(range: HTMLInputElement, number: HTMLInputElement, onChange: (value: number) => void): void {
  range.addEventListener('input', () => {
    number.value = range.value;
    onChange(parseFloat(range.value));
  });
  number.addEventListener('input', () => {
    range.value = number.value;
    onChange(parseFloat(number.value));
  });
}

syncPair(slopeRange, slopeNumber, (value) => {
  params.slope = value;
  onParamsChanged();
});

syncPair(shelfGainRange, shelfGainNumber, (value) => {
  params.shelfGain = value;
  onParamsChanged();
});

shelfEnabledInput.addEventListener('change', () => {
  params.shelfEnabled = shelfEnabledInput.checked;
  shelfGainRange.disabled = !params.shelfEnabled;
  shelfGainNumber.disabled = !params.shelfEnabled;
  onParamsChanged();
});

downloadButton.addEventListener('click', () => {
  if (!currentAdy) return;
  const result = applyCurveToAdy(currentAdy, params);
  const text = serializeAdy(result);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const title = typeof result.title === 'string' && result.title.length > 0 ? result.title : 'corrected';
  a.href = url;
  a.download = `${title}_corrected.ady`;
  a.click();
  URL.revokeObjectURL(url);
});
```

- [ ] **Step 4: Run the full test suite to make sure nothing broke**

Run: `npm test`
Expected: all previously-passing tests still pass (the smoke test plus Tasks 2-8's tests).

- [ ] **Step 5: Run the build to make sure the app compiles**

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 6: Manually verify the end-to-end flow in a browser**

Run: `npm run dev`, then open the printed local URL.

Create a temporary test file outside the repo (e.g. `/tmp/sample.ady`) with this content:

```json
{
  "title": "Sample",
  "enTargetCurveType": 0,
  "detectedChannels": [
    {
      "commandId": "FL",
      "customTargetCurvePoints": [],
      "trimAdjustment": "0.500000",
      "customSpeakerType": "S",
      "responseData": { "0": [1, 2, 3] }
    },
    {
      "commandId": "SW1",
      "customTargetCurvePoints": [],
      "trimAdjustment": "-1.250000",
      "customSpeakerType": "S",
      "responseData": { "0": [4, 5, 6] }
    }
  ]
}
```

Verify, in the browser:
1. Dragging (or picking) `/tmp/sample.ady` shows the editor with a chart.
2. Moving the slope slider updates the chart line and its paired number input.
3. Enabling the bass shelf checkbox enables the shelf gain inputs and visibly rounds off the bass end of the curve.
4. The channel summary table shows `FL` as "Speaker" with `—` trim, and `SW1` as "Subwoofer" with a non-zero trim value.
5. Clicking "Download corrected .ady" downloads a file named `Sample_corrected.ady`; open it and confirm `enTargetCurveType` is `2`, both channels have identical non-empty `customTargetCurvePoints`, and only `SW1`'s `trimAdjustment` changed from `-1.250000`.
6. Load a deliberately broken file (e.g. a `.ady` containing `{not json`) and confirm the error message appears instead of a crash.

- [ ] **Step 7: Commit**

```bash
git add index.html src/style.css src/main.ts
git commit -m "feat: wire up the target curve editor UI"
```

---

### Task 10: GitHub Pages deployment workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `npm test` and `npm run build` (Task 1's scripts).
- Produces: nothing consumed by other tasks — this is the deployment mechanism, verified manually once pushed to GitHub (see Step 3).

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Pages deploy workflow"
```

- [ ] **Step 3: Manual follow-up (not automatable locally — requires your explicit go-ahead)**

This workflow only takes effect once the repo exists on GitHub and Pages is enabled:
1. Create the GitHub repository (public, per the design doc) and push this repo's `main` branch to it.
2. In the repo's Settings → Pages, set Source to "GitHub Actions".
3. Push (or re-run the workflow via the Actions tab) and confirm the "Deploy to GitHub Pages" workflow runs green and the Pages URL serves the app.

This step is a repo-creation-and-push action and should be done together (I will not create the remote repo or push without confirming with you first).

---

## Self-Review Notes

- **Spec coverage:** architecture/module split (Tasks 1, 2, 3-5, 6-7, 8, 9), curve math (Tasks 3-5), output file changes (Task 7), UI & data flow (Task 9), error handling (Tasks 6, 9), testing strategy (unit tests throughout Tasks 2-8, manual verification in Task 9), GitHub Pages deploy (Task 10) — all spec sections have a corresponding task.
- **Placeholders:** none — every step has complete, runnable code or an exact command with expected output.
- **Type consistency:** `CurveParams`, `AdyFile`, `AdyChannel`, `AdyValidationError`, and every function name (`tilt`, `frequencyGrid`, `designGain`, `writtenGain`, `computeTrimShift`, `hfKneeGain`, `parseAdy`, `serializeAdy`, `applyCurveToAdy`, `isSubwooferChannel`, `chartFrequencies`, `designCurveData`, `createChart`, `updateChart`) are used identically across every task that references them.

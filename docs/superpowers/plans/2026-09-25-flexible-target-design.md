# Flexible Target Design (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed slope + bass-shelf controls with a list of standard filter bands, add Audyssey's second HF rolloff shape (shown on the chart), and add a sub-trim option with already-processed detection.

**Architecture:** Small pure modules do the maths and are unit-tested: `bands.ts` (filter responses), `presets.ts`, `rolloff.ts` (two raw rolloff tables). `CurveParams` changes from `{slope, shelfEnabled, shelfGain, cancelHfKnee}` to `{bands, rolloffType, cancelRolloff, subTrim}`; `curve.ts`, `ady.ts`, `generate.ts` and `measuredError.ts` follow. Two DOM layers (an "Audyssey behaviour" box and a band editor) sit on top and are verified in the browser. Spec: `docs/superpowers/specs/2026-09-25-flexible-target-design.md` (read it for the reasoning; this plan is self-contained for the code). Phase 2 (draggable handles, compare slots, design files) is a separate later plan.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`), Vite, Vitest, uPlot. One-off Python (via `uv`) for the rolloff extraction only. No new dependencies in the app.

## Global Constraints

- Static, fully client-side. Nothing is uploaded anywhere.
- Repo is public: **no personal measurements, `.ady` files, `correction*.json` or app screenshots are ever committed.** Test fixtures are synthetic only. `*.ady` and `correction*.json` are already in `.gitignore`.
- `design(f)` is the plain sum of the enabled bands. Band types: Tilt (`slope`, `pivot` default 1000, `fLow`/`fHigh` default 20/20000, holds its edge value outside the range), Low shelf / High shelf (`gain`, `freq`, `q` default 0.707; RBJ analog shelving prototype), Bell (`gain`, `freq`, `q`; analog peaking prototype). No band changes how another behaves. Any number of each type.
- Default design = preset "Current (approximated)": Tilt 0.7 dB/oct, pivot 1000 Hz, `fLow` 50 Hz, `fHigh` 20000 Hz; Low shelf +1.43 dB at 66.5 Hz, Q 0.90. It must stay within 0.1 dB of the previous formula (smoothstep crossfade between a 4.5 dB plateau below 40 Hz and a 0.7 dB/oct tilt above 100 Hz) on the whole write grid, and be 4.50 dB (±0.01) at 20 Hz.
- HF rolloff types: `enTargetCurveType` 1 = "High Frequency Roll Off 1", 2 = "High Frequency Roll Off 2". Both are raw (frequency, gain) tables interpolated in log-frequency; never fitted formulas. Roll Off 2 is `src/hfKneeData.json`; Roll Off 1 is extracted from a MultEQ-X screenshot (about -1.9 dB at 10 kHz, -6.7 dB at 20 kHz, flat below about 3 kHz; Roll Off 2 is -3.5 and -6.1). Only the extracted table is committed, never the screenshot.
- Written curve: `written(f) = design(f) - rolloff_type(f)` when cancel is on; `written = design` when off. What the listener gets (and what the chart shows): `written + rolloff_type`.
- On loading a `.ady` the rolloff type is set from its `enTargetCurveType`; an unrecognised value falls back to Roll Off 2 with a visible notice. The exported `enTargetCurveType` is the selected type (no longer forced to 2).
- Sub trim option `subTrim`: when off the sub's `trimAdjustment` is left exactly as in the input file. Default from detection: a file is "already processed" when any channel's `customTargetCurvePoints` sit exactly on this tool's write grid (`frequencyGrid()`, 2161 points); then the box starts unticked with a visible notice, otherwise ticked.
- Export filename suffix order: `_no-knee-cancel`, `_no-sub-trim`, `_measured-trim`. The "Contains:" line states whether the sub trim is applied or skipped and which rolloff is cancelled or not.
- Generate accepts a measured `.ady` of type 1 or 2 and uses that type's shape for the effective target; any other value is refused with a message naming the supported values. `correction.json` (version 1) is unchanged.
- Invalid band values (non-finite numbers, tilt `fLow >= fHigh`, non-positive frequency or Q) show a visible message; the chart is not updated and the download button is disabled until fixed.
- Chart y-range stays -15..15 dB, x 20 Hz-20 kHz. Shared write grid, sub trim shift logic, measured-correction trims and their maths are unchanged.
- TDD: write the failing test first, watch it fail, then implement. The existing tests must keep passing except where a task explicitly rewrites them.
- Environment: the default Node on PATH is too old. **Before any `npm`/`npx`/`node` command run:**
  ```bash
  export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
  ```
- Static id check (run after any change to `index.html` or the DOM code; it must print nothing):
  ```bash
  cd /Users/esben/Code/target_curve_creator && for id in $(grep -ohE "getElementById\('[^']+'\)|el(<[^>]*>)?\('[^']+'\)" src/*.ts | grep -oE "'[^']+'" | tr -d "'" | sort -u); do grep -q "id=\"$id\"" index.html || echo "MISSING $id"; done
  ```
- Every commit message ends with the line `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (use a heredoc as shown in each task).

## File map

- Create: `src/bands.ts`, `src/bands.test.ts`, `src/presets.ts`, `src/presets.test.ts`, `src/rolloff.ts`, `src/rolloff.test.ts`, `src/hfRolloff1Data.json`, `scripts/extract_rolloff.py`, `src/fixtures/testParams.ts`, `src/bandsUi.ts`
- Modify: `src/hfKnee.ts` (temporarily delegates, deleted in Task 5), `src/curve.ts`, `src/ady.ts`, `src/chart.ts`, `src/downloadSummary.ts`, `src/measuredError.ts`, `src/generate.ts`, `src/correctionUi.ts`, `src/main.ts`, `index.html`, `src/style.css`, and the matching `*.test.ts` files
- Delete (Task 5): `src/hfKnee.ts`, `src/hfKnee.test.ts`

---

### Task 1: Band maths

**Files:**
- Create: `src/bands.ts`
- Test: `src/bands.test.ts`

**Interfaces:**
- Produces (all from `src/bands.ts`):
  - `interface TiltBand { type: 'tilt'; enabled: boolean; slope: number; pivot: number; fLow: number; fHigh: number }`
  - `interface ShelfBand { type: 'lowShelf' | 'highShelf'; enabled: boolean; gain: number; freq: number; q: number }`
  - `interface BellBand { type: 'bell'; enabled: boolean; gain: number; freq: number; q: number }`
  - `type Band = TiltBand | ShelfBand | BellBand`, `type BandType = Band['type']`
  - `const BAND_TYPES: readonly BandType[]`, `const BAND_LABELS: Record<BandType, string>`
  - `bandGain(freq: number, band: Band): number` (0 when disabled)
  - `sumBands(freq: number, bands: readonly Band[]): number`
  - `validateBands(bands: readonly Band[]): string | null`
  - `defaultBand(type: BandType): Band`

- [ ] **Step 1: Write the failing test**

Create `src/bands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BAND_TYPES,
  bandGain,
  defaultBand,
  sumBands,
  validateBands,
  type BellBand,
  type ShelfBand,
  type TiltBand,
} from './bands';

const tilt = (over: Partial<TiltBand> = {}): TiltBand => ({
  type: 'tilt',
  enabled: true,
  slope: 0.7,
  pivot: 1000,
  fLow: 20,
  fHigh: 20000,
  ...over,
});
const shelf = (type: ShelfBand['type'], over: Partial<ShelfBand> = {}): ShelfBand => ({
  type,
  enabled: true,
  gain: 6,
  freq: 100,
  q: 0.707,
  ...over,
});
const bell = (over: Partial<BellBand> = {}): BellBand => ({
  type: 'bell',
  enabled: true,
  gain: 4,
  freq: 1000,
  q: 1,
  ...over,
});

describe('tilt band', () => {
  it('is 0 dB at the pivot and follows slope dB/octave away from it', () => {
    expect(bandGain(1000, tilt({ slope: 3 }))).toBeCloseTo(0, 9);
    expect(bandGain(500, tilt({ slope: 3 }))).toBeCloseTo(3, 9);
    expect(bandGain(2000, tilt({ slope: 3 }))).toBeCloseTo(-3, 9);
  });

  it('uses the pivot it is given', () => {
    expect(bandGain(2000, tilt({ slope: 3, pivot: 2000 }))).toBeCloseTo(0, 9);
  });

  it('holds its value below fLow and above fHigh', () => {
    const t = tilt({ slope: 0.7, fLow: 50, fHigh: 8000 });
    expect(bandGain(20, t)).toBeCloseTo(bandGain(50, t), 12);
    expect(bandGain(30, t)).toBeCloseTo(0.7 * Math.log2(1000 / 50), 9);
    expect(bandGain(16000, t)).toBeCloseTo(bandGain(8000, t), 12);
    // inside the range it still follows the slope
    expect(bandGain(500, t)).toBeCloseTo(0.7, 9);
  });
});

describe('low shelf band', () => {
  it('reaches its full gain far below and 0 dB far above its frequency', () => {
    const s = shelf('lowShelf', { gain: 6, freq: 100 });
    expect(bandGain(1, s)).toBeCloseTo(6, 2);
    expect(bandGain(10000, s)).toBeCloseTo(0, 2);
  });

  it('is exactly half its gain (dB) at its own frequency, whatever the Q', () => {
    for (const q of [0.5, 0.707, 2]) {
      expect(bandGain(100, shelf('lowShelf', { gain: 6, freq: 100, q }))).toBeCloseTo(3, 6);
    }
  });

  it('supports cuts', () => {
    expect(bandGain(1, shelf('lowShelf', { gain: -4, freq: 100 }))).toBeCloseTo(-4, 2);
  });

  it('a higher Q makes the transition steeper (more overshoot near the corner)', () => {
    const soft = bandGain(150, shelf('lowShelf', { gain: 6, freq: 100, q: 0.5 }));
    const sharp = bandGain(150, shelf('lowShelf', { gain: 6, freq: 100, q: 2 }));
    expect(sharp).not.toBeCloseTo(soft, 1);
  });
});

describe('high shelf band', () => {
  it('mirrors the low shelf: 0 dB far below, full gain far above', () => {
    const s = shelf('highShelf', { gain: -5, freq: 8000 });
    expect(bandGain(10, s)).toBeCloseTo(0, 2);
    expect(bandGain(1000000, s)).toBeCloseTo(-5, 2);
    expect(bandGain(8000, s)).toBeCloseTo(-2.5, 6);
  });
});

describe('bell band', () => {
  it('has exactly its gain at the centre and returns to 0 dB far away', () => {
    const b = bell({ gain: 4, freq: 1000, q: 1 });
    expect(bandGain(1000, b)).toBeCloseTo(4, 6);
    expect(bandGain(10, b)).toBeCloseTo(0, 1);
    expect(bandGain(100000, b)).toBeCloseTo(0, 1);
  });

  it('is narrower with a higher Q', () => {
    const wide = bandGain(1500, bell({ q: 0.7 }));
    const narrow = bandGain(1500, bell({ q: 4 }));
    expect(Math.abs(narrow)).toBeLessThan(Math.abs(wide));
  });

  it('supports dips', () => {
    expect(bandGain(3000, bell({ gain: -6, freq: 3000 }))).toBeCloseTo(-6, 6);
  });
});

describe('disabled bands and sums', () => {
  it('a disabled band contributes 0', () => {
    expect(bandGain(500, tilt({ enabled: false }))).toBe(0);
    expect(bandGain(500, bell({ enabled: false }))).toBe(0);
  });

  it('sumBands adds the enabled bands', () => {
    const bands = [tilt({ slope: 3 }), bell({ gain: 4, freq: 500, q: 1 }), shelf('lowShelf', { enabled: false })];
    expect(sumBands(500, bands)).toBeCloseTo(3 + 4, 6);
  });

  it('an empty list is flat', () => {
    expect(sumBands(1234, [])).toBe(0);
  });
});

describe('validateBands', () => {
  it('accepts a valid list and an empty one', () => {
    expect(validateBands([tilt(), shelf('lowShelf'), bell()])).toBeNull();
    expect(validateBands([])).toBeNull();
  });

  it('refuses non-finite numbers, naming the band', () => {
    expect(validateBands([tilt(), bell({ gain: NaN })])).toMatch(/Band 2 \(Bell\)/);
    expect(validateBands([tilt({ slope: Infinity })])).toMatch(/Band 1 \(Tilt\)/);
  });

  it('refuses a tilt whose fLow is not below fHigh', () => {
    expect(validateBands([tilt({ fLow: 500, fHigh: 500 })])).toMatch(/hold below/);
    expect(validateBands([tilt({ fLow: 900, fHigh: 500 })])).not.toBeNull();
  });

  it('refuses non-positive frequencies and Q', () => {
    expect(validateBands([tilt({ pivot: 0 })])).not.toBeNull();
    expect(validateBands([shelf('lowShelf', { freq: 0 })])).not.toBeNull();
    expect(validateBands([bell({ q: 0 })])).toMatch(/Q/);
    expect(validateBands([bell({ freq: -5 })])).not.toBeNull();
  });
});

describe('defaultBand', () => {
  it('gives a valid, enabled band of each type', () => {
    for (const type of BAND_TYPES) {
      const band = defaultBand(type);
      expect(band.type).toBe(type);
      expect(band.enabled).toBe(true);
      expect(validateBands([band])).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; npx vitest run src/bands.test.ts`
Expected: FAIL (cannot resolve `./bands`).

- [ ] **Step 3: Implement**

Create `src/bands.ts`:

```ts
export interface TiltBand {
  type: 'tilt';
  enabled: boolean;
  /** dB per octave; positive = falling toward the treble. */
  slope: number;
  /** Frequency (Hz) where the tilt is 0 dB. */
  pivot: number;
  /** The tilt holds its value below this frequency (Hz). 20 = no limit. */
  fLow: number;
  /** The tilt holds its value above this frequency (Hz). 20000 = no limit. */
  fHigh: number;
}

export interface ShelfBand {
  type: 'lowShelf' | 'highShelf';
  enabled: boolean;
  /** Full shelf gain in dB. */
  gain: number;
  /** Shelf frequency in Hz (the gain is half its dB value here). */
  freq: number;
  q: number;
}

export interface BellBand {
  type: 'bell';
  enabled: boolean;
  gain: number;
  freq: number;
  q: number;
}

export type Band = TiltBand | ShelfBand | BellBand;
export type BandType = Band['type'];

export const BAND_TYPES: readonly BandType[] = ['tilt', 'lowShelf', 'highShelf', 'bell'];

export const BAND_LABELS: Record<BandType, string> = {
  tilt: 'Tilt',
  lowShelf: 'Low shelf',
  highShelf: 'High shelf',
  bell: 'Bell',
};

/** 10*log10(|N|^2 / |D|^2) for complex N and D given as (re, im). */
function ratioDb(numRe: number, numIm: number, denRe: number, denIm: number): number {
  return 10 * Math.log10((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
}

// The three responses below are the magnitudes (in dB) of the standard analog
// prototypes from the RBJ audio-EQ cookbook, evaluated at s = j*f/f0, with
// A = 10^(gain/40) and r = sqrt(A)/Q.

/** H(s) = A * (s^2 + r*s + A) / (A*s^2 + r*s + 1) */
function lowShelfDb(freq: number, gain: number, f0: number, q: number): number {
  const x = freq / f0;
  const a = 10 ** (gain / 40);
  const r = Math.sqrt(a) / q;
  return gain / 2 + ratioDb(a - x * x, r * x, 1 - a * x * x, r * x);
}

/** H(s) = A * (A*s^2 + r*s + 1) / (s^2 + r*s + A) */
function highShelfDb(freq: number, gain: number, f0: number, q: number): number {
  const x = freq / f0;
  const a = 10 ** (gain / 40);
  const r = Math.sqrt(a) / q;
  return gain / 2 + ratioDb(1 - a * x * x, r * x, a - x * x, r * x);
}

/** H(s) = (s^2 + s*A/Q + 1) / (s^2 + s/(A*Q) + 1) */
function bellDb(freq: number, gain: number, f0: number, q: number): number {
  const x = freq / f0;
  const a = 10 ** (gain / 40);
  return ratioDb(1 - x * x, (a / q) * x, 1 - x * x, x / (a * q));
}

/** Contribution of one band (dB) at `freq` (Hz); 0 when the band is disabled. */
export function bandGain(freq: number, band: Band): number {
  if (!band.enabled) return 0;
  switch (band.type) {
    case 'tilt':
      return band.slope * Math.log2(band.pivot / Math.min(band.fHigh, Math.max(band.fLow, freq)));
    case 'lowShelf':
      return lowShelfDb(freq, band.gain, band.freq, band.q);
    case 'highShelf':
      return highShelfDb(freq, band.gain, band.freq, band.q);
    case 'bell':
      return bellDb(freq, band.gain, band.freq, band.q);
  }
}

/** Plain sum of every enabled band at `freq`. */
export function sumBands(freq: number, bands: readonly Band[]): number {
  let total = 0;
  for (const band of bands) total += bandGain(freq, band);
  return total;
}

/** A message describing the first problem in `bands`, or null when they are all usable. */
export function validateBands(bands: readonly Band[]): string | null {
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const where = `Band ${i + 1} (${BAND_LABELS[band.type]})`;
    const numbers =
      band.type === 'tilt' ? [band.slope, band.pivot, band.fLow, band.fHigh] : [band.gain, band.freq, band.q];
    if (numbers.some((n) => !Number.isFinite(n))) return `${where}: every value must be a number.`;
    if (band.type === 'tilt') {
      if (band.pivot <= 0 || band.fLow <= 0 || band.fHigh <= 0) {
        return `${where}: frequencies must be above 0 Hz.`;
      }
      if (band.fLow >= band.fHigh) return `${where}: "hold below" must be lower than "hold above".`;
    } else {
      if (band.freq <= 0) return `${where}: frequency must be above 0 Hz.`;
      if (band.q <= 0) return `${where}: Q must be above 0.`;
    }
  }
  return null;
}

/** A sensible starting band for the "Add band" button. */
export function defaultBand(type: BandType): Band {
  switch (type) {
    case 'tilt':
      return { type, enabled: true, slope: 0.7, pivot: 1000, fLow: 20, fHigh: 20000 };
    case 'lowShelf':
      return { type, enabled: true, gain: 3, freq: 100, q: 0.707 };
    case 'highShelf':
      return { type, enabled: true, gain: -3, freq: 8000, q: 0.707 };
    case 'bell':
      return { type, enabled: true, gain: -3, freq: 3000, q: 1 };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; npx vitest run src/bands.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
npx tsc --noEmit && npm test 2>&1 | tail -6
git add src/bands.ts src/bands.test.ts
git commit -m "$(cat <<'EOF'
feat: add standard filter bands for the design curve

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Presets

**Files:**
- Create: `src/presets.ts`
- Test: `src/presets.test.ts`

**Interfaces:**
- Consumes: `Band`, `sumBands`, `validateBands` from `src/bands.ts` (Task 1)
- Produces (from `src/presets.ts`):
  - `interface Preset { name: string; description: string; bands: Band[] }`
  - `const PRESETS: readonly Preset[]` (order: Flat, Current (approximated))
  - `const DEFAULT_PRESET_NAME = 'Current (approximated)'`
  - `presetBands(name: string): Band[]` (a deep copy; throws `Error` for an unknown name)

- [ ] **Step 1: Write the failing test**

Create `src/presets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sumBands, validateBands } from './bands';
import { DEFAULT_PRESET_NAME, PRESETS, presetBands } from './presets';

/** Copy of the previous design formula, kept here only as a regression reference. */
function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
function previousDesign(freq: number): number {
  const slope = 0.7;
  const shelfGain = 4.5;
  const tilt = slope * Math.log2(1000 / freq);
  const x = (Math.log2(freq) - Math.log2(40)) / (Math.log2(100) - Math.log2(40));
  const w = smoothstep(x);
  return shelfGain * (1 - w) + tilt * w;
}

/** The write grid: 1 Hz steps 20-200, 10 Hz steps 200-20000, ending at 20000. */
function writeGrid(): number[] {
  const grid: number[] = [];
  for (let f = 20; f < 200; f += 1) grid.push(f);
  for (let f = 200; f < 20000; f += 10) grid.push(f);
  grid.push(20000);
  return grid;
}

describe('presets', () => {
  it('ships Flat and the default preset, in that order', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['Flat', 'Current (approximated)']);
    expect(DEFAULT_PRESET_NAME).toBe('Current (approximated)');
  });

  it('Flat is 0 dB everywhere', () => {
    const bands = presetBands('Flat');
    expect(bands).toEqual([]);
    expect(sumBands(123, bands)).toBe(0);
  });

  it('every preset is valid and has a description', () => {
    for (const preset of PRESETS) {
      expect(validateBands(preset.bands)).toBeNull();
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it('the default preset stays within 0.1 dB of the previous formula on the whole write grid', () => {
    const bands = presetBands(DEFAULT_PRESET_NAME);
    let worst = 0;
    for (const f of writeGrid()) {
      worst = Math.max(worst, Math.abs(sumBands(f, bands) - previousDesign(f)));
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('the default preset is 4.50 dB at 20 Hz and 0 dB at 1 kHz', () => {
    const bands = presetBands(DEFAULT_PRESET_NAME);
    expect(sumBands(20, bands)).toBeCloseTo(4.5, 1);
    expect(Math.abs(sumBands(20, bands) - 4.5)).toBeLessThan(0.01);
    expect(sumBands(1000, bands)).toBeCloseTo(0, 3);
  });

  it('presetBands returns a copy: editing it does not change the preset', () => {
    const first = presetBands(DEFAULT_PRESET_NAME);
    first[0].enabled = false;
    (first[1] as { gain: number }).gain = 99;
    const second = presetBands(DEFAULT_PRESET_NAME);
    expect(second[0].enabled).toBe(true);
    expect((second[1] as { gain: number }).gain).toBe(1.43);
  });

  it('throws for an unknown preset name', () => {
    expect(() => presetBands('nope')).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; npx vitest run src/presets.test.ts`
Expected: FAIL (cannot resolve `./presets`).

- [ ] **Step 3: Implement**

Create `src/presets.ts`:

```ts
import type { Band } from './bands';

export interface Preset {
  name: string;
  description: string;
  bands: Band[];
}

export const DEFAULT_PRESET_NAME = 'Current (approximated)';

export const PRESETS: readonly Preset[] = [
  {
    name: 'Flat',
    description: 'No bands: 0 dB everywhere.',
    bands: [],
  },
  {
    name: DEFAULT_PRESET_NAME,
    description:
      'The setup this tool used before bands existed (0.7 dB/oct tilt, 4.5 dB bass shelf), ' +
      'expressed with standard filters. Within 0.075 dB of the original shape.',
    bands: [
      { type: 'tilt', enabled: true, slope: 0.7, pivot: 1000, fLow: 50, fHigh: 20000 },
      { type: 'lowShelf', enabled: true, gain: 1.43, freq: 66.5, q: 0.9 },
    ],
  },
];

/** A deep copy of the named preset's bands, safe to edit. */
export function presetBands(name: string): Band[] {
  const preset = PRESETS.find((p) => p.name === name);
  if (!preset) throw new Error(`Unknown preset "${name}"`);
  return JSON.parse(JSON.stringify(preset.bands)) as Band[];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; npx vitest run src/presets.test.ts`
Expected: PASS. If the 0.1 dB regression fails, report the worst-case value; do not loosen the bound or change the preset numbers (they come from the design spec).

- [ ] **Step 5: Commit**

```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
npx tsc --noEmit && npm test 2>&1 | tail -6
git add src/presets.ts src/presets.test.ts
git commit -m "$(cat <<'EOF'
feat: add Flat and Current (approximated) presets

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The second HF rolloff shape

**Files:**
- Create: `scripts/extract_rolloff.py`, `src/hfRolloff1Data.json`, `src/rolloff.ts`
- Modify: `src/hfKnee.ts`
- Test: `src/rolloff.test.ts`

**Interfaces:**
- Consumes: `src/hfKneeData.json` (`{ "frequency": number[], "gain": number[] }`, the Roll Off 2 table)
- Produces (from `src/rolloff.ts`):
  - `type RolloffType = 1 | 2`, `const ROLLOFF_TYPES: readonly RolloffType[]` (`[1, 2]`)
  - `isRolloffType(value: number): value is RolloffType`
  - `rolloffGain(type: RolloffType, freq: number): number` (dB, log-frequency linear interpolation, clamped to the end values)
- `src/hfKnee.ts` keeps exporting `hfKneeGain(freq)` for now (delegates to `rolloffGain(2, freq)`); it is deleted in Task 5.

- [ ] **Step 1: Write the extraction script**

Create `scripts/extract_rolloff.py`:

```python
"""
One-off extraction of an Audyssey HF rolloff shape from a MultEQ-X "Curve
Editor" screenshot taken with no custom points (the red line is then the
rolloff alone). Writes a raw {frequency, gain} table in the same format as
src/hfKneeData.json.

    uv run --with pillow --with numpy python scripts/extract_rolloff.py \
        "<screenshot.png>" src/hfRolloff1Data.json

The calibration constants below are for the specific 2556x1179 px screenshot
this table was made from ("High Frequency Roll Off 1"). The script re-detects
the plot gridlines and refuses to run if they do not match the constants.
The screenshot itself is NOT committed.
"""
import json
import sys

import numpy as np
from PIL import Image

X_100HZ, X_10KHZ = 719.0, 2091.0    # pixel columns of the 100 Hz and 10 kHz gridlines
Y_PLUS20, Y_MINUS25 = 249.0, 875.0  # pixel rows of the +20 dB and -25 dB gridlines
X_FIRST, X_LAST = 240, 2297         # first/last pixel column of the plot (20 Hz .. 20 kHz)
PLOT = (236, 2302, 246, 948)        # x0, x1, y0, y1 of the plot area, for gridline detection
FLAT_BELOW_HZ = 2500.0              # the curve is visibly flat here; pixel noise is +-0.05 dB


def groups(indices):
    out, start, prev = [], indices[0], indices[0]
    for v in indices[1:]:
        if v != prev + 1:
            out.append((start + prev) / 2)
            start = v
        prev = v
    out.append((start + prev) / 2)
    return out


def check_calibration(img):
    x0, x1, y0, y1 = PLOT
    gray = img[y0:y1, x0:x1].sum(axis=2) / 3
    lines = (gray > 35) & (gray < 200)
    rows = groups(np.where(lines.mean(axis=1) > 0.5)[0] + y0)
    cols = groups(np.where(lines.mean(axis=0) > 0.5)[0] + x0)
    for name, want, found in (
        ("+20 dB row", Y_PLUS20, rows), ("-25 dB row", Y_MINUS25, rows),
        ("100 Hz column", X_100HZ, cols), ("10 kHz column", X_10KHZ, cols),
    ):
        if min(abs(f - want) for f in found) > 1.5:
            sys.exit(f"Calibration mismatch: no gridline near {name} ({want}); found {found}")


def main(png_path, out_path):
    img = np.array(Image.open(png_path).convert("RGB")).astype(int)
    check_calibration(img)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    red = (r > 170) & (g < 100) & (b < 100)

    px_per_decade = (X_10KHZ - X_100HZ) / 2
    px_per_db = (Y_MINUS25 - Y_PLUS20) / 45
    y_zero = Y_PLUS20 + 20 * px_per_db

    freqs, gains = [], []
    for x in range(X_FIRST, X_LAST + 1):
        ys = np.where(red[:, x])[0]
        if len(ys) == 0:
            continue
        f = 100 * 10 ** ((x - X_100HZ) / px_per_decade)
        gain = (y_zero - ys.mean()) / px_per_db
        freqs.append(round(float(f), 4))
        gains.append(0.0 if f <= FLAT_BELOW_HZ else round(float(gain), 4))

    with open(out_path, "w") as fh:
        json.dump({"frequency": freqs, "gain": gains}, fh)
    f_arr, g_arr = np.array(freqs), np.array(gains)
    print(f"{len(freqs)} points, {f_arr.min():.1f}-{f_arr.max():.1f} Hz")
    for hz in (3000, 5000, 8000, 10000, 15000, 20000):
        i = int(np.argmin(abs(f_arr - hz)))
        print(f"  {hz:>6} Hz  {g_arr[i]:6.2f} dB")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
```

- [ ] **Step 2: Run the extraction**

Run:
```bash
cd /Users/esben/Code/target_curve_creator && uv run --with pillow --with numpy python scripts/extract_rolloff.py "/Users/esben/Downloads/Skærmbillede 2026-09-25 kl. 22.15.04.png" src/hfRolloff1Data.json
```
Expected: it prints about 2058 points spanning roughly 20-19990 Hz, and values near 0.0 at 3000 Hz, about -0.4 at 5000, about -1.4 at 8000, about -1.9 at 10000, about -4.1 at 15000... and about -6.7 at 20000. If it stops with "Calibration mismatch", stop and report; do not edit the constants to force it.

- [ ] **Step 3: Write the failing test**

Create `src/rolloff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ROLLOFF_TYPES, isRolloffType, rolloffGain } from './rolloff';

describe('isRolloffType', () => {
  it('accepts exactly 1 and 2', () => {
    expect(ROLLOFF_TYPES).toEqual([1, 2]);
    expect(isRolloffType(1)).toBe(true);
    expect(isRolloffType(2)).toBe(true);
    expect(isRolloffType(0)).toBe(false);
    expect(isRolloffType(3)).toBe(false);
    expect(isRolloffType(1.5)).toBe(false);
  });
});

describe('rolloffGain type 2 (High Frequency Roll Off 2)', () => {
  it('is 0 dB at the bottom and through the midrange', () => {
    expect(rolloffGain(2, 20)).toBeCloseTo(0, 6);
    expect(rolloffGain(2, 100)).toBeCloseTo(0, 4);
    expect(rolloffGain(2, 1000)).toBeCloseTo(0, 4);
  });

  it('matches the extracted table at known points', () => {
    expect(rolloffGain(2, 5000)).toBeCloseTo(-0.5772, 4);
    expect(rolloffGain(2, 10000)).toBeCloseTo(-3.4632, 3);
    expect(rolloffGain(2, 20000)).toBeCloseTo(-6.1328, 3);
  });
});

describe('rolloffGain type 1 (High Frequency Roll Off 1)', () => {
  it('is flat 0 dB below 2.5 kHz', () => {
    for (const f of [20, 100, 1000, 2000, 2500]) expect(rolloffGain(1, f)).toBe(0);
  });

  it('has the extracted shape at 10 kHz and 20 kHz', () => {
    expect(Math.abs(rolloffGain(1, 10000) - -1.87)).toBeLessThan(0.1);
    expect(Math.abs(rolloffGain(1, 20000) - -6.7)).toBeLessThan(0.2);
  });

  it('is gentler than type 2 through the upper midrange and steeper right at the top', () => {
    expect(rolloffGain(1, 10000)).toBeGreaterThan(rolloffGain(2, 10000) + 1);
    expect(rolloffGain(1, 8000)).toBeGreaterThan(rolloffGain(2, 8000) + 0.8);
    expect(rolloffGain(1, 20000)).toBeLessThan(rolloffGain(2, 20000));
  });
});

describe('interpolation and clamping', () => {
  it('interpolates in log-frequency between table points', () => {
    const a = rolloffGain(1, 9000);
    const b = rolloffGain(1, 11000);
    const mid = rolloffGain(1, Math.sqrt(9000 * 11000));
    expect(mid).toBeCloseTo((a + b) / 2, 1);
  });

  it('clamps outside the table to its end values', () => {
    expect(rolloffGain(1, 1)).toBe(rolloffGain(1, 20));
    expect(rolloffGain(1, 1000000)).toBe(rolloffGain(1, 19999));
    expect(rolloffGain(2, 1000000)).toBe(rolloffGain(2, 20000));
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; npx vitest run src/rolloff.test.ts`
Expected: FAIL (cannot resolve `./rolloff`).

- [ ] **Step 5: Implement**

Create `src/rolloff.ts`:

```ts
import hfKneeData from './hfKneeData.json';
import hfRolloff1Data from './hfRolloff1Data.json';

/**
 * Audyssey applies one of two fixed HF rolloff shapes on top of any custom
 * curve, selected by the .ady's top-level `enTargetCurveType`:
 *   1 = "High Frequency Roll Off 1", 2 = "High Frequency Roll Off 2".
 * Both are stored as the raw points read off MultEQ-X's Curve Editor and
 * interpolated directly (log-frequency linear interpolation) rather than
 * fitted to a formula -- a fitted curve left a visible residual against what
 * Audyssey actually applies.
 */
export type RolloffType = 1 | 2;
export const ROLLOFF_TYPES: readonly RolloffType[] = [1, 2];

export function isRolloffType(value: number): value is RolloffType {
  return value === 1 || value === 2;
}

interface Table {
  frequency: number[];
  gain: number[];
}

function makeInterpolator(table: Table): (freq: number) => number {
  const logFreq = table.frequency.map((f) => Math.log10(f));
  const gains = table.gain;
  const last = logFreq.length - 1;
  return (freq: number): number => {
    const x = Math.log10(freq);
    if (x <= logFreq[0]) return gains[0];
    if (x >= logFreq[last]) return gains[last];
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (logFreq[mid] <= x) lo = mid;
      else hi = mid;
    }
    const span = logFreq[hi] - logFreq[lo];
    const t = span === 0 ? 0 : (x - logFreq[lo]) / span;
    return gains[lo] + t * (gains[hi] - gains[lo]);
  };
}

const interpolators: Record<RolloffType, (freq: number) => number> = {
  1: makeInterpolator(hfRolloff1Data),
  2: makeInterpolator(hfKneeData),
};

/** dB gain of the given Audyssey HF rolloff at `freq` (Hz). */
export function rolloffGain(type: RolloffType, freq: number): number {
  return interpolators[type](freq);
}
```

Replace the whole content of `src/hfKnee.ts` with:

```ts
import { rolloffGain } from './rolloff';

/** dB gain of Audyssey's High Frequency Roll Off 2 (enTargetCurveType 2). Kept for existing callers. */
export function hfKneeGain(freq: number): number {
  return rolloffGain(2, freq);
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; npx vitest run src/rolloff.test.ts src/hfKnee.test.ts`
Expected: PASS for both files (the existing `hfKnee.test.ts` must still pass unchanged). If a type-1 sanity bound fails, report the actual numbers from the table; do not widen the bounds.

- [ ] **Step 7: Commit**

```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
npx tsc --noEmit && npm test 2>&1 | tail -6
git status --short
git add scripts/extract_rolloff.py src/hfRolloff1Data.json src/rolloff.ts src/rolloff.test.ts src/hfKnee.ts
git commit -m "$(cat <<'EOF'
feat: add High Frequency Roll Off 1 and a rolloff type lookup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
The screenshot must not appear in `git status`.

---

### Task 4: Switch the core to bands, rolloff type and the sub-trim option

This is the big mechanical switch. After it, the page starts with the default preset, the old slope/shelf controls are gone (the band editor arrives in Task 7), and everything builds and passes.

**Files:**
- Create: `src/fixtures/testParams.ts`
- Modify: `src/curve.ts`, `src/ady.ts`, `src/downloadSummary.ts`, `src/main.ts`, `index.html`
- Modify (tests): `src/curve.test.ts` (rewrite), `src/ady.test.ts`, `src/chart.test.ts`, `src/downloadSummary.test.ts` (rewrite)

**Interfaces:**
- Consumes: `Band`, `sumBands` (Task 1); `presetBands`, `DEFAULT_PRESET_NAME` (Task 2); `RolloffType`, `rolloffGain` (Task 3)
- Produces:
  - `interface CurveParams { bands: Band[]; rolloffType: RolloffType; cancelRolloff: boolean; subTrim: boolean }` (`src/curve.ts`)
  - `designGain(freq, params)`, `writtenGain(freq, params)`, `resultGain(freq, params)` (= `writtenGain + rolloffGain`, what the listener gets), `computeTrimShift(params)`; `tilt`, `frequencyGrid`, `smoothstep`, `TrimFn` are kept
  - `applyCurveToAdy(ady, params, trims?)` writes `enTargetCurveType = params.rolloffType` and only shifts the sub's `trimAdjustment` when `params.subTrim`
  - `looksAlreadyProcessed(ady: AdyFile): boolean` (`src/ady.ts`)
  - `buildDownloadSummary(params, trimmedChannels, cutoffHz)` and `buildFilenameSuffix(params, hasTrims)` (`src/downloadSummary.ts`)
  - `testParams(overrides?: Partial<CurveParams>): CurveParams` and `tiltBands(slope: number): Band[]` (`src/fixtures/testParams.ts`, tests only)

- [ ] **Step 1: Add the test fixture**

Create `src/fixtures/testParams.ts`:

```ts
import type { Band } from '../bands';
import type { CurveParams } from '../curve';
import { DEFAULT_PRESET_NAME, presetBands } from '../presets';

/** Default design (the "Current (approximated)" preset), Roll Off 2, cancel on, sub trim on. */
export function testParams(overrides: Partial<CurveParams> = {}): CurveParams {
  return {
    bands: presetBands(DEFAULT_PRESET_NAME),
    rolloffType: 2,
    cancelRolloff: true,
    subTrim: true,
    ...overrides,
  };
}

/** A single unlimited tilt band, for tests that want a simple known curve. */
export function tiltBands(slope: number): Band[] {
  return [{ type: 'tilt', enabled: true, slope, pivot: 1000, fLow: 20, fHigh: 20000 }];
}
```

- [ ] **Step 2: Rewrite the tests first (they define the new behaviour)**

Replace the whole content of `src/curve.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { computeTrimShift, designGain, frequencyGrid, resultGain, tilt, writtenGain } from './curve';
import { rolloffGain } from './rolloff';
import { testParams, tiltBands } from './fixtures/testParams';

describe('tilt', () => {
  it('is 0dB at the 1kHz pivot regardless of slope', () => {
    expect(tilt(1000, 6)).toBeCloseTo(0, 6);
    expect(tilt(1000, -3)).toBeCloseTo(0, 6);
  });

  it('boosts below the pivot and cuts above it for positive slope', () => {
    expect(tilt(500, 6)).toBeCloseTo(6, 6);
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

  it('has 2161 points', () => {
    expect(frequencyGrid()).toHaveLength(2161);
  });
});

describe('designGain', () => {
  it('is the sum of the bands', () => {
    const params = testParams({ bands: tiltBands(3) });
    expect(designGain(500, params)).toBeCloseTo(tilt(500, 3), 9);
  });

  it('is flat with no bands', () => {
    expect(designGain(777, testParams({ bands: [] }))).toBe(0);
  });
});

describe('writtenGain and resultGain', () => {
  const bands = tiltBands(3);

  it('cancels the selected rolloff in the written curve by default', () => {
    const params = testParams({ bands, rolloffType: 2 });
    expect(writtenGain(10000, params)).toBeCloseTo(designGain(10000, params) - rolloffGain(2, 10000), 9);
  });

  it('cancels Roll Off 1 when that type is selected', () => {
    const params = testParams({ bands, rolloffType: 1 });
    expect(writtenGain(10000, params)).toBeCloseTo(designGain(10000, params) - rolloffGain(1, 10000), 9);
  });

  it('writes the raw design when cancel is off', () => {
    const params = testParams({ bands, cancelRolloff: false });
    expect(writtenGain(10000, params)).toBeCloseTo(designGain(10000, params), 9);
  });

  it('the listener gets the design when the rolloff is cancelled', () => {
    const params = testParams({ bands });
    for (const f of [100, 5000, 10000, 20000]) {
      expect(resultGain(f, params)).toBeCloseTo(designGain(f, params), 9);
    }
  });

  it('the listener gets design + rolloff when cancel is off', () => {
    const params = testParams({ bands, cancelRolloff: false, rolloffType: 1 });
    expect(resultGain(10000, params)).toBeCloseTo(designGain(10000, params) + rolloffGain(1, 10000), 9);
  });
});

describe('computeTrimShift', () => {
  it('is the maximum of the written curve over the write grid', () => {
    const params = testParams({ bands: tiltBands(0.7) });
    const max = Math.max(...frequencyGrid().map((f) => writtenGain(f, params)));
    expect(computeTrimShift(params)).toBeCloseTo(max, 9);
  });

  it('follows the selected rolloff type', () => {
    // a rising curve at 20kHz makes the rolloff type matter for the maximum
    const high = [{ type: 'tilt' as const, enabled: true, slope: -3, pivot: 1000, fLow: 20, fHigh: 20000 }];
    const one = computeTrimShift(testParams({ bands: high, rolloffType: 1 }));
    const two = computeTrimShift(testParams({ bands: high, rolloffType: 2 }));
    expect(one).not.toBeCloseTo(two, 3);
  });
});
```

In `src/chart.test.ts`: replace the import of `designCurveData` with `resultCurveData`, replace `import type { CurveParams } from './curve';` with `import { rolloffGain } from './rolloff';\nimport { testParams, tiltBands } from './fixtures/testParams';`, and replace the whole `describe('designCurveData', ...)` block with:

```ts
describe('resultCurveData', () => {
  it('returns matching-length frequency and gain arrays', () => {
    const [freqs, gains] = resultCurveData(testParams({ bands: tiltBands(3) }));
    expect(freqs.length).toBe(gains.length);
  });

  it('gain near 1kHz is close to 0 for a pure tilt', () => {
    const [freqs, gains] = resultCurveData(testParams({ bands: tiltBands(3) }));
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

  it('shows the design when the rolloff is cancelled and design + rolloff when it is not', () => {
    const cancelled = resultCurveData(testParams({ bands: tiltBands(0), cancelRolloff: true }));
    const shown = resultCurveData(testParams({ bands: tiltBands(0), cancelRolloff: false, rolloffType: 1 }));
    const last = cancelled[0].length - 1;
    expect(cancelled[1][last]).toBeCloseTo(0, 9);
    expect(shown[1][last]).toBeCloseTo(rolloffGain(1, shown[0][last]), 9);
  });
});
```

Replace the whole content of `src/downloadSummary.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { buildDownloadSummary, buildFilenameSuffix } from './downloadSummary';
import { testParams } from './fixtures/testParams';

const DEFAULT_CURVE = '0.7 dB/oct tilt (held below 50 Hz), +1.43 dB low shelf at 66.5 Hz';

describe('buildDownloadSummary', () => {
  it('describes the default design with no correction and everything applied', () => {
    expect(buildDownloadSummary(testParams(), [], 2000)).toBe(
      `Contains: ${DEFAULT_CURVE}; no measured correction; sub trim applied; HF rolloff 2 cancelled.`
    );
  });

  it('lists only the channels that get a trim, with the cutoff', () => {
    expect(buildDownloadSummary(testParams(), ['FL', 'FR', 'C'], 2000)).toContain(
      'measured trim on FL, FR, C above 2000 Hz'
    );
  });

  it('says no measured correction when apply is unticked or the cutoff is null', () => {
    expect(buildDownloadSummary(testParams(), [], null)).toContain('no measured correction');
    expect(buildDownloadSummary(testParams(), ['FL'], null)).toContain('no measured correction');
  });

  it('states when the sub trim is skipped', () => {
    expect(buildDownloadSummary(testParams({ subTrim: false }), [], null)).toContain('sub trim skipped');
  });

  it('states the rolloff type and whether it is cancelled', () => {
    expect(buildDownloadSummary(testParams({ rolloffType: 1, cancelRolloff: false }), [], null)).toContain(
      'HF rolloff 1 not cancelled'
    );
  });

  it('describes every band type and skips disabled bands', () => {
    const params = testParams({
      bands: [
        { type: 'tilt', enabled: true, slope: 1, pivot: 1000, fLow: 20, fHigh: 20000 },
        { type: 'highShelf', enabled: true, gain: -2, freq: 8000, q: 0.707 },
        { type: 'bell', enabled: true, gain: -3, freq: 3000, q: 1.4 },
        { type: 'lowShelf', enabled: false, gain: 5, freq: 60, q: 0.707 },
      ],
    });
    expect(buildDownloadSummary(params, [], null)).toContain(
      'Contains: 1 dB/oct tilt, -2 dB high shelf at 8000 Hz, -3 dB bell at 3000 Hz (Q 1.4);'
    );
  });

  it('says flat when there are no enabled bands', () => {
    expect(buildDownloadSummary(testParams({ bands: [] }), [], null)).toContain('Contains: flat curve;');
  });
});

describe('buildFilenameSuffix', () => {
  it('is empty for the default settings without trims', () => {
    expect(buildFilenameSuffix(testParams(), false)).toBe('');
  });

  it('orders the suffixes no-knee-cancel, no-sub-trim, measured-trim', () => {
    expect(buildFilenameSuffix(testParams({ cancelRolloff: false, subTrim: false }), true)).toBe(
      '_no-knee-cancel_no-sub-trim_measured-trim'
    );
  });

  it('adds only what applies', () => {
    expect(buildFilenameSuffix(testParams({ subTrim: false }), false)).toBe('_no-sub-trim');
    expect(buildFilenameSuffix(testParams(), true)).toBe('_measured-trim');
  });
});
```

In `src/ady.test.ts`:
1. Replace the import line `import { computeTrimShift, designGain, frequencyGrid, writtenGain, type CurveParams, type TrimFn } from './curve';` with:
   ```ts
   import { computeTrimShift, designGain, frequencyGrid, writtenGain, type TrimFn } from './curve';
   import { testParams, tiltBands } from './fixtures/testParams';
   ```
   and add `looksAlreadyProcessed` to the `import { applyCurveToAdy, hasAppliedTrims, serializeAdy } from './ady';` line.
2. In the first `describe('applyCurveToAdy', ...)` replace `const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };` with `const params = testParams({ bands: tiltBands(3) });`.
3. In that block replace the test `forces enTargetCurveType to 2` with:
   ```ts
   it('writes the selected rolloff type as enTargetCurveType', () => {
     expect(applyCurveToAdy(createSampleAdy(), params).enTargetCurveType).toBe(2);
     expect(applyCurveToAdy(createSampleAdy(), { ...params, rolloffType: 1 }).enTargetCurveType).toBe(1);
   });

   it('leaves the sub trimAdjustment exactly as it was when subTrim is off', () => {
     const result = applyCurveToAdy(createSampleAdy(), { ...params, subTrim: false });
     expect(result.detectedChannels[1].trimAdjustment).toBe('-1.250000');
     // the curves are still written to every channel
     expect(result.detectedChannels[1].customTargetCurvePoints).toHaveLength(frequencyGrid().length);
   });
   ```
4. Replace the test `writes the raw designed curve (no knee cancellation) when cancelHfKnee is false` body's first line `const noCancel: CurveParams = { ...params, cancelHfKnee: false };` with `const noCancel = { ...params, cancelRolloff: false };` (rest unchanged).
5. In the trims `describe` block replace `const params: CurveParams = { slope: 0.7, shelfEnabled: false, shelfGain: 0 };` with `const params = testParams({ bands: tiltBands(0.7) });` and every `{ ...params, cancelHfKnee: false }` with `{ ...params, cancelRolloff: false }`.
6. Append at the end of the file:
   ```ts
   describe('looksAlreadyProcessed', () => {
     it('is false for a raw file with no custom points', () => {
       expect(looksAlreadyProcessed(createSampleAdy())).toBe(false);
     });

     it('is true for a file this tool wrote', () => {
       const written = applyCurveToAdy(createSampleAdy(), testParams());
       expect(looksAlreadyProcessed(written)).toBe(true);
       expect(looksAlreadyProcessed(parseAdy(serializeAdy(written)))).toBe(true);
     });

     it('is false for custom points on some other grid', () => {
       const ady = createSampleAdy();
       ady.detectedChannels[0].customTargetCurvePoints = ['{20.0, 0.000}', '{1000.0, 0.000}', '{20000.0, 0.000}'];
       expect(looksAlreadyProcessed(ady)).toBe(false);
     });

     it('is false when the point count matches but a frequency does not', () => {
       const written = applyCurveToAdy(createSampleAdy(), testParams());
       written.detectedChannels[0].customTargetCurvePoints[500] = '{999.0, 0.000}';
       written.detectedChannels[1].customTargetCurvePoints = [];
       expect(looksAlreadyProcessed(written)).toBe(false);
     });
   });
   ```
   (`parseAdy` is already imported at the top of that test file.)

- [ ] **Step 3: Run to verify the tests fail**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; npx vitest run src/curve.test.ts src/ady.test.ts src/chart.test.ts src/downloadSummary.test.ts`
Expected: FAIL (missing `resultGain`, `resultCurveData`, `buildFilenameSuffix`, `looksAlreadyProcessed`, and the new `CurveParams` shape).

- [ ] **Step 4: Rewrite `src/curve.ts`**

Replace the whole file with:

```ts
import { sumBands, type Band } from './bands';
import { rolloffGain, type RolloffType } from './rolloff';

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

/** Extra gain (dB) added on top of a channel's written curve, as a function of frequency. */
export type TrimFn = (freq: number) => number;

export interface CurveParams {
  /** The design curve is the plain sum of these bands. */
  bands: Band[];
  /** Which of Audyssey's two fixed HF rolloff shapes the AVR applies (enTargetCurveType). */
  rolloffType: RolloffType;
  /**
   * Pre-cancel that rolloff in the written curve so the design is what you
   * actually get. Untick to write the design as is; the listener then also
   * gets the rolloff on top.
   */
  cancelRolloff: boolean;
  /** Shift the subwoofer's trimAdjustment to compensate Audyssey's 0dB-max renormalisation. */
  subTrim: boolean;
}

/** Smooth 0->1 ease with zero slope at both ends. */
export function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** The curve you are designing: the sum of the enabled bands. */
export function designGain(freq: number, params: CurveParams): number {
  return sumBands(freq, params.bands);
}

/**
 * The curve actually written to the .ady file: the design with the selected
 * HF rolloff pre-cancelled (unless cancelRolloff is false), so the design is
 * what you get after Audyssey applies its own rolloff on top.
 */
export function writtenGain(freq: number, params: CurveParams): number {
  const design = designGain(freq, params);
  return params.cancelRolloff ? design - rolloffGain(params.rolloffType, freq) : design;
}

/** What the listener gets: the written curve plus the rolloff Audyssey always applies. This is what the chart shows. */
export function resultGain(freq: number, params: CurveParams): number {
  return writtenGain(freq, params) + rolloffGain(params.rolloffType, freq);
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

- [ ] **Step 5: Update `src/ady.ts`**

1. Delete the line `const FORCED_TARGET_CURVE_TYPE = 2;`.
2. Replace the doc comment and body of `applyCurveToAdy` (from `/** Returns a new AdyFile ...` down to the closing brace of the function) with:

```ts
/**
 * Returns a new AdyFile with the designed curve written to every channel and
 * enTargetCurveType set to the selected HF rolloff type. When params.subTrim
 * is on, subwoofer trim is compensated; when off, the sub's trimAdjustment is
 * left exactly as it was. Non-subwoofer channels that have an entry in
 * `trims` get that per-channel trim added on top of the shared curve.
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
    if (isSubwooferChannel(channel) && params.subTrim) {
      const originalTrim = parseFloat(channel.trimAdjustment);
      channel.trimAdjustment = (originalTrim + trimShift).toFixed(6);
    }
  }

  clone.enTargetCurveType = params.rolloffType;
  return clone;
}
```

3. Append after `hasAppliedTrims`:

```ts
const POINT_FREQUENCY = /^\{\s*([0-9.]+)\s*,/;

/**
 * True when some channel's customTargetCurvePoints sit exactly on this tool's
 * write grid (2161 points, 1 Hz then 10 Hz steps). Such a file was very likely
 * written by this tool (or the script it replaced), so the sub trim was
 * probably already applied to it. A heuristic: files from other sources may
 * not match.
 */
export function looksAlreadyProcessed(ady: AdyFile): boolean {
  const grid = frequencyGrid();
  return ady.detectedChannels.some((channel) => {
    const points = channel.customTargetCurvePoints;
    if (points.length !== grid.length) return false;
    return points.every((point, i) => {
      const match = POINT_FREQUENCY.exec(point);
      return match !== null && Math.abs(parseFloat(match[1]) - grid[i]) < 0.06;
    });
  });
}
```

- [ ] **Step 6: Update `src/chart.ts`**

Replace the import `import { designGain, type CurveParams } from './curve';` with `import { resultGain, type CurveParams } from './curve';`, then replace `designCurveData` with:

```ts
/** [frequencies, gains] for the live preview chart: what the listener gets (design + any rolloff left on). */
export function resultCurveData(params: CurveParams): [number[], number[]] {
  const freqs = chartFrequencies();
  const gains = freqs.map((f) => resultGain(f, params));
  return [freqs, gains];
}
```

and replace the two uses `designCurveData(params)` in `createChart`/`updateChart` with `resultCurveData(params)`.

- [ ] **Step 7: Rewrite `src/downloadSummary.ts`**

Replace the whole file with:

```ts
import type { Band } from './bands';
import type { CurveParams } from './curve';

/** Number without trailing zeros, at most 2 decimals. */
function num(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${num(value)}`;
}

function describeBand(band: Band): string {
  switch (band.type) {
    case 'tilt': {
      let text = `${num(band.slope)} dB/oct tilt`;
      if (band.pivot !== 1000) text += ` around ${num(band.pivot)} Hz`;
      if (band.fLow > 20) text += ` (held below ${num(band.fLow)} Hz)`;
      if (band.fHigh < 20000) text += ` (held above ${num(band.fHigh)} Hz)`;
      return text;
    }
    case 'lowShelf':
      return `${signed(band.gain)} dB low shelf at ${num(band.freq)} Hz`;
    case 'highShelf':
      return `${signed(band.gain)} dB high shelf at ${num(band.freq)} Hz`;
    case 'bell':
      return `${signed(band.gain)} dB bell at ${num(band.freq)} Hz (Q ${num(band.q)})`;
  }
}

/**
 * One-line description of what the downloaded .ady will contain.
 * `trimmedChannels` must only list channels that actually get a measured trim.
 */
export function buildDownloadSummary(
  params: CurveParams,
  trimmedChannels: readonly string[],
  cutoffHz: number | null
): string {
  const enabled = params.bands.filter((b) => b.enabled);
  const curve = enabled.length > 0 ? enabled.map(describeBand).join(', ') : 'flat curve';
  const trim =
    trimmedChannels.length > 0 && cutoffHz !== null
      ? `measured trim on ${trimmedChannels.join(', ')} above ${cutoffHz} Hz`
      : 'no measured correction';
  const sub = params.subTrim ? 'sub trim applied' : 'sub trim skipped';
  const rolloff = `HF rolloff ${params.rolloffType} ${params.cancelRolloff ? 'cancelled' : 'not cancelled'}`;
  return `Contains: ${[curve, trim, sub, rolloff].join('; ')}.`;
}

/** Filename suffix that tells test variants apart from the normal export. */
export function buildFilenameSuffix(params: CurveParams, hasTrims: boolean): string {
  return (
    (params.cancelRolloff ? '' : '_no-knee-cancel') +
    (params.subTrim ? '' : '_no-sub-trim') +
    (hasTrims ? '_measured-trim' : '')
  );
}
```

- [ ] **Step 8: Update `src/main.ts` and `index.html`**

In `index.html` replace the whole `<div id="controls"> ... </div>` block (the slope, bass shelf, shelf gain and cancel labels) with:

```html
        <div id="controls">
          <label>
            <input type="checkbox" id="cancel-hf-knee" checked />
            Cancel Audyssey's HF rolloff
            <small>(uncheck only to test whether the AVR applies it)</small>
          </label>
        </div>
```

In `src/main.ts` make exactly these changes:
1. Imports: change `import { computeTrimShift, type CurveParams } from './curve';` to
   ```ts
   import { computeTrimShift, type CurveParams } from './curve';
   import { DEFAULT_PRESET_NAME, presetBands } from './presets';
   ```
   and change `import { buildDownloadSummary } from './downloadSummary';` to `import { buildDownloadSummary, buildFilenameSuffix } from './downloadSummary';`.
2. Replace the `const params: CurveParams = { ... };` block with:
   ```ts
   const params: CurveParams = {
     bands: presetBands(DEFAULT_PRESET_NAME),
     rolloffType: 2,
     cancelRolloff: true,
     subTrim: true,
   };
   ```
3. Delete the element constants `slopeRange`, `slopeNumber`, `shelfEnabledInput`, `shelfGainRange`, `shelfGainNumber`, the whole `function syncPair(...) { ... }`, the two `syncPair(...)` calls and the `shelfEnabledInput.addEventListener(...)` block.
4. Replace the cancel checkbox handler with:
   ```ts
   cancelHfKneeInput.addEventListener('change', () => {
     params.cancelRolloff = cancelHfKneeInput.checked;
     onParamsChanged();
   });
   ```
5. In `renderChannelSummary`, replace `trimCell.textContent = isSub ? trimShift.toFixed(2) : '—';` with `trimCell.textContent = isSub ? (params.subTrim ? trimShift.toFixed(2) : 'skipped') : '—';`.
6. In the download handler replace the whole `const suffix = ...;` expression with `const suffix = buildFilenameSuffix(params, hasAppliedTrims(currentAdy, trims));`.

- [ ] **Step 9: Run everything**

Run:
```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
npx vitest run src/curve.test.ts src/ady.test.ts src/chart.test.ts src/downloadSummary.test.ts
```
Expected: PASS. Then the whole suite and the build: `npx tsc --noEmit && npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -3` (expected: all tests pass, build succeeds). Other test files (`generate.test.ts`, `measuredError.test.ts`, `correction.test.ts`, `acceptance`) still use `hfKneeGain` and must pass unchanged. Run the static id check from Global Constraints (must print nothing). Remove stray build output: `rm -f src/*.js tsconfig.tsbuildinfo`.

- [ ] **Step 10: Commit**

```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
git add src/fixtures/testParams.ts src/curve.ts src/curve.test.ts src/ady.ts src/ady.test.ts src/chart.ts src/chart.test.ts src/downloadSummary.ts src/downloadSummary.test.ts src/main.ts index.html
git commit -m "$(cat <<'EOF'
feat: build the design curve from bands, with rolloff type and sub trim options

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rolloff types in the measured-correction side

**Files:**
- Modify: `src/measuredError.ts`, `src/generate.ts`, `src/correctionUi.ts`
- Modify (tests): `src/measuredError.test.ts`, `src/generate.test.ts`, `src/rolloff.test.ts`
- Delete: `src/hfKnee.ts`, `src/hfKnee.test.ts`

**Interfaces:**
- Consumes: `rolloffGain`, `RolloffType`, `isRolloffType`, `ROLLOFF_TYPES` (Task 3)
- Produces:
  - `effectiveTarget(channel: AdyChannel, rolloffType: RolloffType): number[]`
  - `computeError(measurements: readonly RewMeasurement[], channel: AdyChannel, rolloffType: RolloffType): number[]`
  - `checkMeasuredType(ady: AdyFile): RolloffType` (`src/generate.ts`; throws `GenerateError` naming the supported values)
  - `REQUIRED_TARGET_CURVE_TYPE` is removed. `generateCorrection` reads the type from the measured `.ady`.

- [ ] **Step 1: Update the tests first**

`src/measuredError.test.ts`:
- Replace `import { hfKneeGain } from './hfKnee';` with `import { rolloffGain } from './rolloff';`.
- Every `hfKneeGain(x)` becomes `rolloffGain(2, x)`.
- Every call `effectiveTarget(<channel>)` becomes `effectiveTarget(<channel>, 2)`, and every call `computeError(<measurements>, <channel>)` becomes `computeError(<measurements>, <channel>, 2)`.
- Add to the `describe('effectiveTarget', ...)` block:
  ```ts
  it('uses the shape of the given rolloff type', () => {
    const grid = logGrid();
    const one = effectiveTarget(channelWith([]), 1);
    const two = effectiveTarget(channelWith([]), 2);
    const i = grid.findIndex((f) => f >= 10000);
    // both are ~0 dB across 500-1500 Hz, so level normalisation shifts them equally
    expect(one[i] - two[i]).toBeCloseTo(rolloffGain(1, grid[i]) - rolloffGain(2, grid[i]), 3);
    expect(one[i]).toBeGreaterThan(two[i] + 1);
  });
  ```

`src/generate.test.ts`:
- Replace the imports `GenerateError, REQUIRED_TARGET_CURVE_TYPE, generateCorrection` with `GenerateError, checkMeasuredType, generateCorrection`, and `import { hfKneeGain } from './hfKnee';` with `import { rolloffGain } from './rolloff';`.
- In `measuredAdy()` replace `ady.enTargetCurveType = REQUIRED_TARGET_CURVE_TYPE;` with `ady.enTargetCurveType = 2;`, and replace `hfKneeGain(f)` by `rolloffGain(2, f)` in `measuredFn` and in the `wild` function of the RMS-warning test.
- Find the existing test that refuses a non-type-2 `.ady` (it sets `enTargetCurveType` to another value and expects `GenerateError`); keep it but make it use `0` and match `/enTargetCurveType 0/`.
- Add:
  ```ts
  it('accepts a type-1 .ady and uses the Roll Off 1 shape for the target', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 1;
    const one = (f: number) => 70 + rolloffGain(1, f) + bump(f);
    const { correction, warnings } = generateCorrection(
      ady,
      [{ commandId: 'FL', files: [file('L1.txt', one)] }],
      '',
      NOW
    );
    const i = logGrid().findIndex((f) => f >= 8000);
    expect(correction.channels.FL.error[i]).toBeCloseTo(1.5, 1);
    expect(warnings).toEqual([]);
  });

  it('a Roll Off 2 measurement read as type 1 shows the difference between the shapes', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 1;
    const { correction } = generateCorrection(ady, [{ commandId: 'FL', files: [file('L1.txt')] }], '', NOW);
    const grid = logGrid();
    // 12.5 kHz: Roll Off 2 is about 1.5 dB lower than Roll Off 1 there, and the 8 kHz test bump is negligible
    const i = grid.findIndex((f) => f >= 12500);
    expect(correction.channels.FL.error[i]).toBeLessThan(-1);
  });

  it('checkMeasuredType returns the type for 1 and 2 and refuses everything else naming the supported values', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 1;
    expect(checkMeasuredType(ady)).toBe(1);
    ady.enTargetCurveType = 2;
    expect(checkMeasuredType(ady)).toBe(2);
    ady.enTargetCurveType = 3;
    expect(() => checkMeasuredType(ady)).toThrow(GenerateError);
    expect(() => checkMeasuredType(ady)).toThrow(/1 and 2/);
  });
  ```

`src/rolloff.test.ts`: move the assertions of `src/hfKnee.test.ts` in as a new block `describe('rolloffGain type 2 (previous hfKnee tests)', ...)`: copy each `it` from `hfKnee.test.ts` and replace `hfKneeGain(x)` by `rolloffGain(2, x)`.

- [ ] **Step 2: Run to verify the tests fail**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; npx vitest run src/measuredError.test.ts src/generate.test.ts src/rolloff.test.ts`
Expected: FAIL (`checkMeasuredType` missing, `effectiveTarget` arity).

- [ ] **Step 3: Implement**

`src/measuredError.ts`: replace `import { hfKneeGain } from './hfKnee';` with `import { rolloffGain, type RolloffType } from './rolloff';`; change the `effectiveTarget` doc/signature/body to:

```ts
/**
 * What Audyssey is actually aiming for on this channel: the written curve plus
 * the HF rolloff it always applies on top (the rolloff alone for a stock
 * calibration), level-normalised so only shape matters.
 */
export function effectiveTarget(channel: AdyChannel, rolloffType: RolloffType): number[] {
  const grid = logGrid();
  const written = writtenCurve(channel);
  return normalizeLevel(grid.map((f, i) => written[i] + rolloffGain(rolloffType, f)));
}
```

and `computeError` to:

```ts
export function computeError(
  measurements: readonly RewMeasurement[],
  channel: AdyChannel,
  rolloffType: RolloffType
): number[] {
  if (measurements.length === 0) throw new Error('computeError: no measurements');
  const measured = normalizeLevel(averagePositions(measurements.map(smoothToGrid)));
  const target = effectiveTarget(channel, rolloffType);
  return measured.map((v, i) => v - target[i]);
}
```
(keep the existing doc comment above `computeError`).

`src/generate.ts`: add `import { ROLLOFF_TYPES, isRolloffType, type RolloffType } from './rolloff';`; delete the `REQUIRED_TARGET_CURVE_TYPE` constant and its comment; add after `GenerateError`:

```ts
/**
 * The HF rolloff type the measured .ady was made with. Only types 1 and 2 have
 * a known shape, so anything else is refused.
 */
export function checkMeasuredType(ady: AdyFile): RolloffType {
  const type = ady.enTargetCurveType;
  if (!isRolloffType(type)) {
    throw new GenerateError(
      `That .ady has enTargetCurveType ${type}; this tool supports ${ROLLOFF_TYPES.join(' and ')} ` +
        `(High Frequency Roll Off ${ROLLOFF_TYPES.join(' and ')}).`
    );
  }
  return type;
}
```

In `generateCorrection` replace the `if (measuredAdy.enTargetCurveType !== REQUIRED_TARGET_CURVE_TYPE) { throw ... }` block with `const rolloffType = checkMeasuredType(measuredAdy);` and change `computeError(measurements, channel)` to `computeError(measurements, channel, rolloffType)`.

`src/correctionUi.ts`: change the import to `import { checkMeasuredType, generateCorrection, type GenerateResult, type SpeakerInput } from './generate';` and replace the block

```ts
      if (parsed.enTargetCurveType !== REQUIRED_TARGET_CURVE_TYPE) {
        throw new Error(
          `That .ady has enTargetCurveType ${parsed.enTargetCurveType}; it must be ${REQUIRED_TARGET_CURVE_TYPE} (the value this tool writes).`
        );
      }
```
with `checkMeasuredType(parsed);`.

Delete the old module: `git rm src/hfKnee.ts src/hfKnee.test.ts`.

- [ ] **Step 4: Run everything**

Run:
```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
npx tsc --noEmit && npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -3
grep -rn "hfKnee\|hfKneeGain\|REQUIRED_TARGET" src scripts | grep -v hfKneeData.json
```
Expected: tsc clean, all tests pass, build succeeds, the `grep` prints nothing (only `rolloff.ts` legitimately imports `hfKneeData.json`, and the filter removes that line). Run the static id check (must print nothing). `rm -f src/*.js tsconfig.tsbuildinfo`.

- [ ] **Step 5: Commit**

```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
git add -A src scripts
git commit -m "$(cat <<'EOF'
feat: generate corrections against either HF rolloff type

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: "Audyssey behaviour" box (rolloff type, cancel, sub trim)

DOM code: verified by build, the static id check, and the browser pass in Task 8. The pure parts are already tested.

**Files:**
- Modify: `index.html`, `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `isRolloffType` (Task 3); `looksAlreadyProcessed` (Task 4); `CurveParams` (Task 4)

- [ ] **Step 1: Replace the controls block in `index.html`**

Replace the whole `<div id="controls"> ... </div>` block (now containing only the cancel checkbox) with:

```html
        <fieldset id="audyssey-behaviour">
          <legend>Audyssey behaviour</legend>
          <label>
            HF rolloff type
            <select id="rolloff-type">
              <option value="1">High Frequency Roll Off 1</option>
              <option value="2">High Frequency Roll Off 2</option>
            </select>
          </label>
          <p id="rolloff-notice" class="warning" hidden></p>
          <label>
            <input type="checkbox" id="cancel-hf-knee" checked />
            Cancel Audyssey's HF rolloff
            <small>(untick to see the rolloff on the curve, as the AVR applies it)</small>
          </label>
          <label>
            <input type="checkbox" id="sub-trim" checked />
            Compensate sub trim
          </label>
          <p id="sub-trim-notice" class="warning" hidden></p>
        </fieldset>
```

- [ ] **Step 2: Wire it in `src/main.ts`**

1. Imports: change `import { parseAdy, ... } from './ady'` list to include `looksAlreadyProcessed`, and add `import { isRolloffType } from './rolloff';`.
2. Add element constants next to the existing ones:
   ```ts
   const rolloffTypeSelect = document.getElementById('rolloff-type') as HTMLSelectElement;
   const rolloffNotice = document.getElementById('rolloff-notice') as HTMLElement;
   const subTrimInput = document.getElementById('sub-trim') as HTMLInputElement;
   const subTrimNotice = document.getElementById('sub-trim-notice') as HTMLElement;
   ```
3. Add this function above `loadFile`:
   ```ts
   /** Sets the rolloff type and the sub-trim default from the freshly loaded file. */
   function applyFileDefaults(ady: AdyFile): void {
     const type = ady.enTargetCurveType;
     if (isRolloffType(type)) {
       params.rolloffType = type;
       rolloffNotice.hidden = true;
     } else {
       params.rolloffType = 2;
       rolloffNotice.textContent = `This file's enTargetCurveType is ${type}, which is not a known HF rolloff. Using Roll Off 2; change it above if needed.`;
       rolloffNotice.hidden = false;
     }
     rolloffTypeSelect.value = String(params.rolloffType);

     const processed = looksAlreadyProcessed(ady);
     params.subTrim = !processed;
     subTrimInput.checked = params.subTrim;
     if (processed) {
       subTrimNotice.textContent =
         'This file already has a target curve written by this tool, so its sub trim was probably already compensated. Sub trim compensation is off; tick it if you know it is not.';
     }
     subTrimNotice.hidden = !processed;
   }
   ```
4. In `loadFile`, right after `currentAdy = parseAdy(text);` add `applyFileDefaults(currentAdy);`.
5. Add handlers next to the cancel handler:
   ```ts
   rolloffTypeSelect.addEventListener('change', () => {
     const value = Number(rolloffTypeSelect.value);
     if (isRolloffType(value)) params.rolloffType = value;
     rolloffNotice.hidden = true;
     onParamsChanged();
   });

   subTrimInput.addEventListener('change', () => {
     params.subTrim = subTrimInput.checked;
     subTrimNotice.hidden = true;
     onParamsChanged();
   });
   ```

- [ ] **Step 3: Style**

Append to `src/style.css`:

```css
#audyssey-behaviour {
  border: 1px solid #333;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin: 0 0 1rem;
}

#audyssey-behaviour legend {
  padding: 0 0.4rem;
  color: #ccc;
}

#audyssey-behaviour label {
  display: block;
  margin-bottom: 0.6rem;
}
```

- [ ] **Step 4: Verify**

Run:
```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
npx tsc --noEmit && npm test 2>&1 | tail -6 && npm run build 2>&1 | tail -3
cd /Users/esben/Code/target_curve_creator && for id in $(grep -ohE "getElementById\('[^']+'\)|el(<[^>]*>)?\('[^']+'\)" src/*.ts | grep -oE "'[^']+'" | tr -d "'" | sort -u); do grep -q "id=\"$id\"" index.html || echo "MISSING $id"; done
rm -f src/*.js tsconfig.tsbuildinfo
```
Expected: clean type-check, all tests pass, build succeeds, id check prints nothing. The browser check is Task 8.

- [ ] **Step 5: Commit**

```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
git add index.html src/main.ts src/style.css
git commit -m "$(cat <<'EOF'
feat: add rolloff type and sub trim controls with already-processed detection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Band editor UI

DOM code: verified by build, the static id check, and the browser pass in Task 8.

**Files:**
- Create: `src/bandsUi.ts`
- Modify: `index.html`, `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `Band`, `BandType`, `BAND_TYPES`, `BAND_LABELS`, `defaultBand`, `sumBands`, `validateBands` (Task 1); `PRESETS`, `presetBands` (Task 2); `CurveParams` (Task 4)
- Produces: `initBandsUi(params: CurveParams, onChange: () => void): { render(): void }` (`src/bandsUi.ts`). It edits `params.bands` in place, calls `onChange` after every edit, and re-renders the rows itself on structural changes (add, delete, preset). The order of bands does not matter (the design is a plain sum), so there are no reorder controls.

- [ ] **Step 1: Add the markup**

In `index.html`, inside `<section id="editor">`, immediately after the `<fieldset id="audyssey-behaviour">...</fieldset>` block and before `<div id="chart"></div>`, insert:

```html
        <div id="bands">
          <h3>Curve bands</h3>
          <div id="band-toolbar">
            <label>
              Preset
              <select id="preset-select">
                <option value="">Load preset…</option>
              </select>
            </label>
            <span id="add-band-group">
              <select id="add-band-type"></select>
              <button type="button" id="add-band">Add band</button>
            </span>
          </div>
          <p id="preset-description" class="hint"></p>
          <div id="band-list"></div>
          <p id="band-error" class="error" hidden></p>
          <p id="band-level" class="hint"></p>
        </div>
```

- [ ] **Step 2: Create `src/bandsUi.ts`**

```ts
import { BAND_LABELS, BAND_TYPES, defaultBand, type Band, type BandType } from './bands';
import type { CurveParams } from './curve';
import { PRESETS, presetBands } from './presets';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

interface FieldSpec {
  label: string;
  key: string;
  step: string;
}

/** Which numeric fields each band type shows, in order. */
function fieldsFor(type: BandType): FieldSpec[] {
  if (type === 'tilt') {
    return [
      { label: 'Slope (dB/oct)', key: 'slope', step: '0.1' },
      { label: 'Pivot (Hz)', key: 'pivot', step: '10' },
      { label: 'Hold below (Hz)', key: 'fLow', step: '5' },
      { label: 'Hold above (Hz)', key: 'fHigh', step: '100' },
    ];
  }
  return [
    { label: 'Gain (dB)', key: 'gain', step: '0.1' },
    { label: 'Frequency (Hz)', key: 'freq', step: '1' },
    { label: 'Q', key: 'q', step: '0.05' },
  ];
}

/**
 * Renders and edits `params.bands` in place. Numeric fields update the model on
 * every valid number typed (an empty or non-numeric field is ignored, keeping
 * the last value); structural changes (add, delete, preset) re-render the rows.
 */
export function initBandsUi(params: CurveParams, onChange: () => void): { render(): void } {
  const list = el<HTMLElement>('band-list');
  const presetSelect = el<HTMLSelectElement>('preset-select');
  const presetDescription = el<HTMLElement>('preset-description');
  const addType = el<HTMLSelectElement>('add-band-type');
  const addButton = el<HTMLButtonElement>('add-band');

  for (const preset of PRESETS) {
    const option = document.createElement('option');
    option.value = preset.name;
    option.textContent = preset.name;
    presetSelect.appendChild(option);
  }
  for (const type of BAND_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = BAND_LABELS[type];
    addType.appendChild(option);
  }

  function renderRow(band: Band, index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'band';

    const header = document.createElement('div');
    header.className = 'band-header';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = band.enabled;
    enabled.title = 'Enable or disable this band';
    enabled.addEventListener('change', () => {
      band.enabled = enabled.checked;
      row.classList.toggle('band-off', !band.enabled);
      onChange();
    });
    header.appendChild(enabled);

    const title = document.createElement('strong');
    title.textContent = `${index + 1}. ${BAND_LABELS[band.type]}`;
    header.appendChild(title);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = 'Delete this band';
    remove.addEventListener('click', () => {
      params.bands.splice(index, 1);
      render();
      onChange();
    });
    header.appendChild(remove);
    row.appendChild(header);

    const fields = document.createElement('div');
    fields.className = 'band-fields';
    for (const spec of fieldsFor(band.type)) {
      const label = document.createElement('label');
      label.textContent = spec.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = spec.step;
      input.value = String((band as unknown as Record<string, number>)[spec.key]);
      input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        if (!Number.isFinite(value)) return; // cleared or invalid: keep the last value
        (band as unknown as Record<string, number>)[spec.key] = value;
        onChange();
      });
      label.appendChild(input);
      fields.appendChild(label);
    }
    row.appendChild(fields);
    row.classList.toggle('band-off', !band.enabled);
    return row;
  }

  function render(): void {
    list.innerHTML = '';
    params.bands.forEach((band, index) => list.appendChild(renderRow(band, index)));
    if (params.bands.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No bands: the design is flat. Add a band or load a preset.';
      list.appendChild(empty);
    }
  }

  presetSelect.addEventListener('change', () => {
    const name = presetSelect.value;
    if (!name) return;
    params.bands = presetBands(name);
    presetDescription.textContent = PRESETS.find((p) => p.name === name)?.description ?? '';
    presetSelect.value = '';
    render();
    onChange();
  });

  addButton.addEventListener('click', () => {
    params.bands.push(defaultBand(addType.value as BandType));
    render();
    onChange();
  });

  render();
  return { render };
}
```

- [ ] **Step 3: Wire it in `src/main.ts`**

1. Imports: add
   ```ts
   import { initBandsUi } from './bandsUi';
   import { sumBands, validateBands } from './bands';
   ```
2. After `const correctionUi = initCorrectionUi(() => onParamsChanged());` add:
   ```ts
   const bandError = document.getElementById('band-error') as HTMLElement;
   const bandLevel = document.getElementById('band-level') as HTMLElement;
   const bandsUi = initBandsUi(params, () => onParamsChanged());
   ```
3. Replace the whole `onParamsChanged` function with:
   ```ts
   function onParamsChanged(): void {
     const problem = validateBands(params.bands);
     bandError.textContent = problem ?? '';
     bandError.hidden = problem === null;
     downloadButton.disabled = problem !== null;
     if (problem !== null) return; // keep the last good chart; nothing is exported meanwhile
     bandLevel.textContent = `Level at 20 Hz: ${sumBands(20, params.bands).toFixed(2)} dB`;
     if (chart) updateChart(chart, params);
     if (currentAdy) {
       renderChannelSummary();
       renderDownloadSummary();
     }
   }
   ```
4. At the end of `loadFile`'s `try` block (after the chart is created/updated) add `bandsUi.render();` and `onParamsChanged();` so the readout shows straight away. Also call `onParamsChanged();` once at the bottom of the file (after all handlers are registered) so the level line is filled before any file is loaded.
5. In the download handler add as first line after `if (!currentAdy) return;`: `if (validateBands(params.bands) !== null) return;`.

- [ ] **Step 4: Style**

Append to `src/style.css`:

```css
#bands {
  margin: 0 0 1rem;
}

#band-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.band {
  border: 1px solid #333;
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
}

.band-off {
  opacity: 0.5;
}

.band-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.4rem;
}

.band-header button {
  margin-left: auto;
}

.band-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}

.band-fields label {
  display: flex;
  flex-direction: column;
  font-size: 0.85rem;
  color: #ccc;
}

.band-fields input {
  width: 7rem;
}
```

- [ ] **Step 5: Verify**

Run:
```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
npx tsc --noEmit && npm test 2>&1 | tail -6 && npm run build 2>&1 | tail -3
cd /Users/esben/Code/target_curve_creator && for id in $(grep -ohE "getElementById\('[^']+'\)|el(<[^>]*>)?\('[^']+'\)" src/*.ts | grep -oE "'[^']+'" | tr -d "'" | sort -u); do grep -q "id=\"$id\"" index.html || echo "MISSING $id"; done
rm -f src/*.js tsconfig.tsbuildinfo
```
Expected: clean type-check, all tests pass, build succeeds, id check prints nothing.

- [ ] **Step 6: Commit**

```bash
export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null
git add src/bandsUi.ts index.html src/main.ts src/style.css
git commit -m "$(cat <<'EOF'
feat: add the band editor with presets

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verification (controller does this; needs browser tooling and the user's local files)

No new production code. If a check fails, stop and report rather than editing around it.

- [ ] **Step 1: Whole-suite check**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; npx tsc --noEmit && npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -3`
Expected: everything passes and builds; `git status --short` is empty.

- [ ] **Step 2: Manual browser verification**

Start the dev server (`npm run dev -- --port 5173 --strictPort`), open `http://localhost:5173/`, inject synthetic `.ady` files with the `DataTransfer` technique (build a small FL/FR/SW1 `.ady` in JS; never real files). Verify:

1. Fresh page and after loading a type-0 file: the rolloff notice appears ("not a known HF rolloff … using Roll Off 2") and the select shows Roll Off 2. A type-1 file preselects Roll Off 1 with no notice; a type-2 file preselects Roll Off 2.
2. With the default bands the chart matches the previous default (about 4.5 dB at 20 Hz, falling to 0 dB at 1 kHz, about -2.3 dB at 3.3 kHz... down to about -2.3 dB at 20 kHz), and the "Level at 20 Hz" line reads 4.50 dB.
3. Unticking "Cancel Audyssey's HF rolloff" makes the chart drop at the top end by the selected rolloff (Roll Off 1: about -1.9 dB at 10 kHz; Roll Off 2: about -3.5 dB). Switching the type changes the shape. Ticking it again restores the design curve.
4. Bands: add each of the four types; edit values; the chart follows live; disable a band (row dims, chart changes); delete a band; "Load preset" replaces the list (Flat gives a flat chart; Current restores the default) and shows the description. Making a tilt's "hold below" ≥ "hold above" shows the red message, keeps the last chart, disables the download button; fixing it re-enables.
5. Sub trim: a raw file starts with "Compensate sub trim" ticked and no notice. Export it (capture the download by wrapping `URL.createObjectURL`), then load that exported text back in as the base: the box starts unticked with the "already has a target curve" notice. With it unticked, export again: the sub's `trimAdjustment` equals the input's, the filename ends `_no-sub-trim.ady`, and the "Contains:" line says "sub trim skipped". Ticking it shifts the sub as before.
6. The exported `enTargetCurveType` equals the selected rolloff type (1 or 2), not always 2. Filename suffix order with everything on: `_no-knee-cancel_no-sub-trim_measured-trim`.
7. Measured correction: the generate dialog accepts a type-1 measured `.ady` and a type-2 one, refuses type 0 with the "supports 1 and 2" message; generating still closes the dialog and loads the correction.
8. Console: no app errors.

- [ ] **Step 3: Local acceptance run with the user's real files**

Run: `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null; REAL_DATA_DIR=/Users/esben/Downloads npx vitest run scripts/acceptance.local.test.ts`
Expected: the four tests pass. **Caveat:** the `Default.ady` currently in that folder is type 1 (Roll Off 1) while the earlier stock measurements (`L.txt`, `R.txt`, `C.txt`) may have been made with a type-2 calibration. If a bound fails, do not loosen it: report the failing numbers to the user, who knows which file matches which measurement.

- [ ] **Step 4: Stock-measurement check with the correct rolloff shape (local only, nothing committed)**

Write `analyze_stock.py` in the session scratchpad directory (not the repo) and run it with `uv run --with numpy python <scratchpad>/analyze_stock.py`:

```python
import json
import numpy as np

DL = "/Users/esben/Downloads/"
REPO = "/Users/esben/Code/target_curve_creator/src/"
ref = np.loadtxt(DL + "RMS Default.txt", delimiter=",")   # 5-speaker RMS of the stock calibration
f_raw, spl = ref[:, 0], ref[:, 1]

centers = 20 * 2 ** (np.arange(0, 24 * np.log2(20000 / 20) + 1) / 24)
def smooth(y, width_oct=1 / 6):
    p = 10 ** (y / 10)
    out = np.empty_like(centers)
    for i, fc in enumerate(centers):
        lo, hi = fc * 2 ** (-width_oct / 2), fc * 2 ** (width_oct / 2)
        a, b = np.searchsorted(f_raw, [lo, hi])
        out[i] = 10 * np.log10(p[a:b].mean())
    return out

def table(name):
    d = json.load(open(REPO + name))
    return np.interp(np.log10(centers), np.log10(d["frequency"]), d["gain"])

m = smooth(spl)
band = (centers >= 500) & (centers <= 1500)
m = m - m[band].mean()
box = lambda y: np.convolve(np.pad(y, (12, 12), mode="edge"), np.ones(25) / 25, mode="valid")
e1 = box(m - table("hfRolloff1Data.json"))   # stock measurement read as Roll Off 1
e2 = box(m - table("hfKneeData.json"))       # ... read as Roll Off 2
print("freq    E(type1)  E(type2)   [1-octave smoothed, dB]")
for f in (2000, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000):
    i = int(np.argmin(abs(centers - f)))
    print(f"{f:>6}  {e1[i]:8.2f}  {e2[i]:8.2f}")
```

Report the two columns to the user. The earlier finding was a stable error of roughly -1 to -1.5 dB around 3-4 kHz and +1 to +2.5 dB above about 6 kHz. The user decides which `.ady` type the stock measurement belonged to; if the earlier finding only holds under one of the two columns, that column names the rolloff the stock calibration really used.

- [ ] **Step 5: Final review, then stop**

Dispatch the final whole-branch review (most capable model) with `scripts/review-package` from the commit that added this plan document (the one just before Task 1's commit; find it with `git log --oneline -- docs/superpowers/plans/2026-09-25-flexible-target-design.md`) to `HEAD`. Fix Critical/Important findings in one fix wave. Do not push until the user says so.

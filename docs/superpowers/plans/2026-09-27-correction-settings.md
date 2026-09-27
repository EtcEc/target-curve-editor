# Correction Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Detail, Strength and Limit settings to the measured correction, as sliders on the Correct page.

**Architecture:** `trimFromError` and its callers take an optional `TrimOptions` (defaults = today's behaviour), so existing callers and tests keep working. The Correct page holds one `TrimOptions` object fed by three range inputs.

**Tech Stack:** TypeScript (strict), Vite, Vitest. No new dependencies.

Spec: `docs/superpowers/specs/2026-09-27-two-workflows-design.md`, section "Correction settings".

## Global Constraints

- Every shell command runs with Node 20 via nvm: prefix with `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null;` and wrap test/build commands in `timeout 120`.
- Before each commit: `npx tsc --noEmit -p . && npx vitest run && npm run build` pass.
- Commit messages end with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (verbatim).
- No new dependencies; synthetic test data only.
- Detail steps ⅓, ½, ⅔, 1, 1½, 2, 3 octaves, default 1. Strength 0-100 % in 10 % steps, default 100 %. Limit 0.5-10 dB in 0.5 dB steps, default 3 dB.
- Trim pipeline order: average over the detail width, re-pin at 1 kHz, scale by strength, clamp to ±limit, fade around the cutoff, negate.

---

### Task 1: Trim options in the maths, preview and checklist

**Files:**
- Modify: `src/correction.ts`, `src/correction.test.ts`, `src/correctionPreview.ts`, `src/correctionPreview.test.ts`, `src/downloadSummary.ts`, `src/downloadSummary.test.ts`

**Interfaces:**
- Produces: `interface TrimOptions { detailOctaves: number; strength: number; limitDb: number }`; `DETAIL_STEPS: readonly number[]`; `DEFAULT_TRIM_OPTIONS: Readonly<TrimOptions>`; `MIN_LIMIT_DB = 0.5`, `MAX_LIMIT_DB = 10`; `formatOctaves(octaves: number): string`; `trimFromError(error, freq, cutoffHz, options = DEFAULT_TRIM_OPTIONS)`; `buildChannelTrims(correction, cutoffHz, options = DEFAULT_TRIM_OPTIONS)`; `summarizeCorrection(correction, cutoffHz, options = DEFAULT_TRIM_OPTIONS)`; `previewCurves(channel, rolloffType, correction, cutoffHz, options = DEFAULT_TRIM_OPTIONS)`; `correctChecklist(channels, cutoffHz, options = DEFAULT_TRIM_OPTIONS)`.

- [ ] **Step 1: Write the failing tests**

In `src/correction.test.ts`, extend the import from `./correction` with `DEFAULT_TRIM_OPTIONS, DETAIL_STEPS, MAX_LIMIT_DB, MIN_LIMIT_DB, formatOctaves` and append:

```ts
describe('trim options', () => {
  const at = (options: Partial<typeof DEFAULT_TRIM_OPTIONS>, error = shelf(2), cutoff = 4000) =>
    trimFromError(error, freq, cutoff, { ...DEFAULT_TRIM_OPTIONS, ...options });

  it('has the documented steps, defaults and limits', () => {
    expect(DETAIL_STEPS).toEqual([1 / 3, 1 / 2, 2 / 3, 1, 1.5, 2, 3]);
    expect(DEFAULT_TRIM_OPTIONS).toEqual({ detailOctaves: 1, strength: 1, limitDb: 3 });
    expect(MIN_LIMIT_DB).toBe(0.5);
    expect(MAX_LIMIT_DB).toBe(10);
  });

  it('behaves exactly as before with the default options', () => {
    const error = freq.map((f) => Math.sin(Math.log2(f)) * 2);
    const plain = trimFromError(error, freq, 500);
    const explicit = trimFromError(error, freq, 500, DEFAULT_TRIM_OPTIONS);
    for (const f of freq) expect(explicit(f)).toBe(plain(f));
  });

  it('scales the correction by strength', () => {
    expect(at({ strength: 0.5 })(10000)).toBeCloseTo(-1, 6);
    for (const f of freq) expect(at({ strength: 0 })(f)).toBeCloseTo(0, 12);
  });

  it('caps every cut and boost at the limit, after strength', () => {
    expect(at({ limitDb: 1 })(10000)).toBeCloseTo(-1, 6);
    expect(at({ strength: 0.5 }, shelf(10))(10000)).toBeCloseTo(-3, 6);
    expect(at({ strength: 0.5, limitDb: 6 }, shelf(10))(10000)).toBeCloseTo(-5, 6);
    expect(at({ limitDb: 6 }, shelf(-10))(10000)).toBeCloseTo(6, 6);
  });

  it('follows a narrow feature with fine detail and averages it away with coarse detail', () => {
    // a 3 dB step one third of an octave wide, centred on 8 kHz
    const narrow = freq.map((f) => (f >= 8000 / 2 ** (1 / 6) && f <= 8000 * 2 ** (1 / 6) ? 3 : 0));
    const fine = Math.abs(at({ detailOctaves: 1 / 3 }, narrow, 2000)(8000));
    const coarse = Math.abs(at({ detailOctaves: 3 }, narrow, 2000)(8000));
    expect(fine).toBeGreaterThan(2);
    expect(coarse).toBeLessThan(0.6);
  });

  it('keeps the 1 kHz pin for every detail width', () => {
    const sloped = freq.map((f) => Math.log2(f / 200));
    for (const detailOctaves of DETAIL_STEPS) {
      expect(Math.abs(at({ detailOctaves }, sloped, 300)(1000))).toBeLessThan(0.01);
    }
  });

  it('refuses settings outside their range', () => {
    expect(() => at({ detailOctaves: 0 })).toThrow(/Detail/);
    expect(() => at({ strength: -0.1 })).toThrow(/Strength/);
    expect(() => at({ strength: 1.1 })).toThrow(/Strength/);
    expect(() => at({ limitDb: 0 })).toThrow(/Limit/);
    expect(() => at({ limitDb: NaN })).toThrow(/Limit/);
  });

  it('passes the options through buildChannelTrims and summarizeCorrection', () => {
    const correction: Correction = { FL: { positions: 1, error: shelf(2) } };
    const options = { ...DEFAULT_TRIM_OPTIONS, limitDb: 1 };
    expect(buildChannelTrims(correction, 4000, options).get('FL')!(10000)).toBeCloseTo(-1, 6);
    expect(summarizeCorrection(correction, 4000, options)[0].maxAbsTrim).toBeCloseTo(1, 6);
  });

  it('formats detail widths as short fractions', () => {
    expect(DETAIL_STEPS.map(formatOctaves)).toEqual(['⅓', '½', '⅔', '1', '1½', '2', '3']);
  });
});
```

In `src/correctionPreview.test.ts`, extend the `./correction` import with `DEFAULT_TRIM_OPTIONS` and append inside the `describe('previewCurves', …)` block:

```ts
  it('uses the trim options for the corrected line', () => {
    const options = { ...DEFAULT_TRIM_OPTIONS, strength: 0.5, limitDb: 0.5 };
    const curves = previewCurves(channel(), 2, { positions: 1, error }, 500, options);
    const trim = trimFromError(error, grid, 500, options);
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(curves.current[i] + trim(grid[i]), 9));
  });
```

In `src/downloadSummary.test.ts`, extend the import from `./downloadSummary` as needed, add `import { DEFAULT_TRIM_OPTIONS } from './correction';`, and replace the whole `describe('correctChecklist', …)` block with:

```ts
describe('correctChecklist', () => {
  it('names the corrected channels, the fade and the settings, and says what stays the same', () => {
    expect(correctChecklist(['FL', 'FR', 'C'], 500)).toEqual([
      { text: 'Measured correction on FL, FR, C, fading in from 354 Hz to 707 Hz (cutoff 500 Hz)', on: true },
      { text: 'Detail 1 oct · strength 100% · limit ±3 dB', on: true },
      { text: 'Unchanged below the fade; each curve keeps its level at 1 kHz', on: true },
      { text: 'Sub, channel levels and HF rolloff unchanged', on: true },
    ]);
  });

  it('shows non-default settings', () => {
    const options = { ...DEFAULT_TRIM_OPTIONS, detailOctaves: 1 / 3, strength: 0.7, limitDb: 4.5 };
    expect(correctChecklist(['FL'], 500, options)[1].text).toBe('Detail ⅓ oct · strength 70% · limit ±4.5 dB');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/correction.test.ts src/correctionPreview.test.ts src/downloadSummary.test.ts`
Expected: FAIL (missing exports; checklist has 3 items).

- [ ] **Step 3: Implement the options in `src/correction.ts`**

Replace the three constants `SMOOTH_HALF_WIDTH_POINTS`, `TRIM_CLAMP_DB` and `FADE_WIDTH_OCTAVES` (with their comments) and the whole `trimFromError` function (with its doc comment) with:

```ts
/** The shared log grid has 24 points per octave. */
const GRID_POINTS_PER_OCTAVE = 24;
/** The trim fades in over this many octaves, centred on the cutoff. */
const FADE_WIDTH_OCTAVES = 1;

/** How the measured error becomes a trim. */
export interface TrimOptions {
  /** Width (octaves) the error is averaged over: small follows narrow features, large only broad trends. */
  detailOctaves: number;
  /** Fraction of the error that is corrected, 0-1. */
  strength: number;
  /** Largest cut or boost, in dB. */
  limitDb: number;
}

/** The detail widths offered on the Correct page. */
export const DETAIL_STEPS: readonly number[] = [1 / 3, 1 / 2, 2 / 3, 1, 1.5, 2, 3];
export const DEFAULT_TRIM_OPTIONS: Readonly<TrimOptions> = { detailOctaves: 1, strength: 1, limitDb: 3 };
export const MIN_LIMIT_DB = 0.5;
export const MAX_LIMIT_DB = 10;

const OCTAVE_LABELS: ReadonlyMap<number, string> = new Map([
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [1.5, '1½'],
]);

/** A detail width as a short label, e.g. 0.5 -> "½", 1.5 -> "1½", 2 -> "2". */
export function formatOctaves(octaves: number): string {
  return OCTAVE_LABELS.get(octaves) ?? String(octaves);
}

/**
 * Turns a measured error curve into a trim: average over the detail width,
 * re-pin so the averaged error is 0 at 1 kHz (each curve keeps its value
 * there), scale by strength, clamp to +/- the limit, fade in around the cutoff,
 * negate. The returned function looks the trim up by log-frequency
 * interpolation between `freq` points.
 */
export function trimFromError(
  error: readonly number[],
  freq: readonly number[],
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): TrimFn {
  if (!Number.isFinite(cutoffHz) || cutoffHz <= 0) {
    throw new Error(`Cutoff must be a positive finite frequency, got ${cutoffHz}`);
  }
  const { detailOctaves, strength, limitDb } = options;
  if (!(Number.isFinite(detailOctaves) && detailOctaves > 0)) {
    throw new Error(`Detail must be a positive number of octaves, got ${detailOctaves}`);
  }
  if (!(strength >= 0 && strength <= 1)) {
    throw new Error(`Strength must be between 0 and 1, got ${strength}`);
  }
  if (!(Number.isFinite(limitDb) && limitDb > 0)) {
    throw new Error(`Limit must be a positive number of dB, got ${limitDb}`);
  }
  const halfWidth = Math.round((GRID_POINTS_PER_OCTAVE * detailOctaves) / 2);
  const n = error.length;
  const smoothed = error.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - halfWidth; j <= i + halfWidth; j++) {
      sum += error[Math.min(n - 1, Math.max(0, j))];
      count++;
    }
    return sum / count;
  });
  const pin = interpLogFreq(freq, smoothed, ANCHOR_HZ);
  const trims = smoothed.map((value, i) => {
    const clamped = Math.max(-limitDb, Math.min(limitDb, strength * (value - pin)));
    const weight = smoothstep(Math.log2(freq[i] / cutoffHz) / FADE_WIDTH_OCTAVES + 0.5);
    return -weight * clamped;
  });
  return (f: number) => interpLogFreq(freq, trims, f);
}
```

Change `buildChannelTrims` and `summarizeCorrection` to take `options: TrimOptions = DEFAULT_TRIM_OPTIONS` as their last parameter and pass it to `trimFromError`:

```ts
/** One trim function per channel in the correction, for the given cutoff and options. */
export function buildChannelTrims(
  correction: Correction,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): Map<string, TrimFn> {
  const freq = logGrid();
  const trims = new Map<string, TrimFn>();
  for (const [id, channel] of Object.entries(correction)) {
    trims.set(id, trimFromError(channel.error, freq, cutoffHz, options));
  }
  return trims;
}
```

```ts
export function summarizeCorrection(
  correction: Correction,
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): TrimSummaryRow[] {
  const freq = logGrid();
  return Object.entries(correction).map(([commandId, channel]) => {
    const trim = trimFromError(channel.error, freq, cutoffHz, options);
    let maxAbsTrim = 0;
    for (const f of freq) maxAbsTrim = Math.max(maxAbsTrim, Math.abs(trim(f)));
    return { commandId, positions: channel.positions, maxAbsTrim };
  });
}
```

- [ ] **Step 4: Preview and checklist**

In `src/correctionPreview.ts`: import `DEFAULT_TRIM_OPTIONS, type TrimOptions` from `./correction`; add a last parameter `options: TrimOptions = DEFAULT_TRIM_OPTIONS` to `previewCurves` and pass it: `trimFromError(correction.error, freq, cutoffHz, options)`.

In `src/downloadSummary.ts`: add `import { DEFAULT_TRIM_OPTIONS, formatOctaves, type TrimOptions } from './correction';` and replace `correctChecklist` with:

```ts
/** What the Correct page's download will contain. */
export function correctChecklist(
  channels: readonly string[],
  cutoffHz: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS
): ChecklistItem[] {
  const lo = Math.round(cutoffHz / Math.SQRT2);
  const hi = Math.round(cutoffHz * Math.SQRT2);
  return [
    {
      text: `Measured correction on ${channels.join(', ')}, fading in from ${lo} Hz to ${hi} Hz (cutoff ${cutoffHz} Hz)`,
      on: true,
    },
    {
      text: `Detail ${formatOctaves(options.detailOctaves)} oct · strength ${Math.round(options.strength * 100)}% · limit ±${options.limitDb} dB`,
      on: true,
    },
    { text: 'Unchanged below the fade; each curve keeps its level at 1 kHz', on: true },
    { text: 'Sub, channel levels and HF rolloff unchanged', on: true },
  ];
}
```

- [ ] **Step 5: Run the tests, then commit**

Run: `npx tsc --noEmit -p . && npx vitest run && npm run build`
Expected: all pass (existing callers compile unchanged because the options are optional).

```bash
git add src
git commit -m "feat: detail, strength and limit options for the measured correction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The three sliders on the Correct page

**Files:**
- Modify: `correct.html`, `src/correct/main.ts`, `src/style.css`

**Interfaces:**
- Consumes (Task 1): `TrimOptions`, `DEFAULT_TRIM_OPTIONS`, `DETAIL_STEPS`, `MIN_LIMIT_DB`, `MAX_LIMIT_DB`, `formatOctaves`, and the `options` parameter of `summarizeCorrection`, `buildChannelTrims`, `previewCurves`, `correctChecklist`.

- [ ] **Step 1: HTML**

In `correct.html`, directly after the `<p class="hint">` that follows the Cutoff field (the one starting "Nothing changes below cutoff ÷ √2"), insert:

```html
              <div class="settings">
                <label class="field">
                  Detail
                  <span class="range-row"><input type="range" id="detail" /><output id="detail-value"></output></span>
                </label>
                <label class="field">
                  Strength
                  <span class="range-row"><input type="range" id="strength" /><output id="strength-value"></output></span>
                </label>
                <label class="field">
                  Limit
                  <span class="range-row"><input type="range" id="limit" /><output id="limit-value"></output></span>
                </label>
              </div>
              <p class="hint">
                Detail is how wide an area the measured error is averaged over: small values follow narrower
                features, large values correct only broad trends. Strength is how much of the error is corrected.
                Limit caps every cut and boost.
              </p>
```

- [ ] **Step 2: CSS**

Append to `src/style.css`:

```css
/* correct page: correction settings */

.settings {
  display: grid;
  gap: 0.6rem;
  margin-top: 0.75rem;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.range-row input[type='range'] {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.range-row output {
  min-width: 4.5rem;
  color: var(--text);
  font-size: 0.9rem;
  text-align: right;
}
```

- [ ] **Step 3: Wire the sliders in `src/correct/main.ts`**

- Extend the import from `'../correction'` with `DEFAULT_TRIM_OPTIONS`, `DETAIL_STEPS`, `MAX_LIMIT_DB`, `MIN_LIMIT_DB`, `formatOctaves`, `type TrimOptions`.
- After `const cutoffInput = el<HTMLInputElement>('cutoff');` add:

```ts
const detailInput = el<HTMLInputElement>('detail');
const detailValue = el<HTMLElement>('detail-value');
const strengthInput = el<HTMLInputElement>('strength');
const strengthValue = el<HTMLElement>('strength-value');
const limitInput = el<HTMLInputElement>('limit');
const limitValue = el<HTMLElement>('limit-value');
```

- After `let cutoffHz = DEFAULT_CUTOFF_HZ;` add:

```ts
/** Detail, strength and limit, as set by the sliders. */
const trimOptions: TrimOptions = { ...DEFAULT_TRIM_OPTIONS };
```

- After the three `cutoffInput.min/max/value` lines add:

```ts
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

/** Reads the three sliders into `trimOptions` and shows their values. */
function readSettings(): void {
  trimOptions.detailOctaves = DETAIL_STEPS[Number(detailInput.value)] ?? DEFAULT_TRIM_OPTIONS.detailOctaves;
  trimOptions.strength = Number(strengthInput.value) / 100;
  trimOptions.limitDb = Number(limitInput.value);
  detailValue.textContent = `${formatOctaves(trimOptions.detailOctaves)} oct`;
  strengthValue.textContent = `${Math.round(trimOptions.strength * 100)}%`;
  limitValue.textContent = `±${trimOptions.limitDb} dB`;
}
```

- Pass `trimOptions` as the last argument in the four calls: `summarizeCorrection(result.correction, cutoffHz, trimOptions)`, `previewCurves(channel, rolloffType, result.correction[keep], cutoffHz, trimOptions)`, `correctChecklist(Object.keys(result.correction), cutoffHz, trimOptions)`, `buildChannelTrims(result.correction, cutoffHz, trimOptions)`.
- After the `previewChannel` change listener add:

```ts
for (const input of [detailInput, strengthInput, limitInput]) {
  input.addEventListener('input', () => {
    readSettings();
    render();
  });
}
```

- Add `readSettings();` on the line before the final `bindFileNames();`.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit -p . && npx vitest run && npm run build`
Expected: all pass, including `scripts/page-ids.test.ts` (the new ids exist in `correct.html`).

```bash
git add correct.html src
git commit -m "feat: detail, strength and limit sliders on the correct page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

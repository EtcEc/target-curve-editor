# Two Workflows and Workbench Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the tool into a start page, a Design page and a Correct page; the Correct page adds a measured correction to the curve already in a `.ady`, anchored and pinned at 1 kHz; the Design page gets the two-column workbench layout and a consistent card style.

**Architecture:** Pure logic stays in `src/*.ts` with unit tests (correction maths, the new `applyMeasuredCorrection`, checklists, preview data). Each page has its own HTML file and entry script (`src/design/main.ts`, `src/correct/main.ts`); a Vite multi-page build emits all three pages. One stylesheet (`src/style.css`) with colour tokens serves every page.

**Tech Stack:** TypeScript (strict, `noUnusedLocals/Parameters`), Vite 5 multi-page, Vitest 2, uPlot. No new dependencies.

Spec: `docs/superpowers/specs/2026-09-27-two-workflows-design.md`.

## Global Constraints

- No new dependencies. Vanilla TypeScript and CSS.
- Repo is public: tests use synthetic data only; never commit `.ady`, REW exports or `correction*.json`.
- Every shell command runs with Node 20 via nvm: prefix with `export NVM_DIR="$HOME/.nvm"; source "/opt/homebrew/opt/nvm/nvm.sh"; cd /Users/esben/Code/target_curve_creator; nvm use >/dev/null;`
- Before each commit: `npx tsc --noEmit -p . && npx vitest run` pass; from Task 4 on also `npm run build`.
- Commit messages end with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (verbatim).
- Correction maths: anchor = mean over the octave centred on 1 kHz (707.1-1414.2 Hz); the 1-octave-smoothed error is re-pinned to 0 at 1 kHz before the ±3 dB clamp; `DEFAULT_CUTOFF_HZ = 500`, cutoff range 100-18000 Hz.
- The Correct page never changes any `trimAdjustment`, `enTargetCurveType`, the sub's points, or channels without a correction.
- Colour tokens: accent `#5b6cff`; wide layout from `min-width: 960px`; chart height 420 px wide, 220 px narrow.
- Refinement of the spec: the Design page puts "Save or load a design" in its own card below the bands card (the spec listed it inside the presets card).

## File Structure

- `src/ady.ts` — `applyCurveToAdy` loses its `trims` argument; new `applyMeasuredCorrection`, `MeasuredCorrectionError`; `formatPoint` never writes `-0.000`.
- `src/curvePoints.ts` (new) — `readCurvePoints`, `TargetParseError`.
- `src/measuredError.ts` — 1 kHz anchor (`ANCHOR_HZ`), uses `readCurvePoints`.
- `src/correction.ts` — in-memory `Correction` model, pin at 1 kHz, new cutoff constants; file parse/serialise removed.
- `src/generate.ts` — `measureCorrection(ady, speakers)` replaces `generateCorrection`.
- `src/correctionPreview.ts` (new) — `previewCurves`.
- `src/downloadSummary.ts` — checklists (`designChecklist`, `correctChecklist`), `buildFilenameSuffix(params)`, `measuredFilename`.
- `src/ui/checklist.ts`, `src/ui/filePick.ts` (new) — tiny DOM helpers.
- `src/chart.ts` — `baseChartOptions`, `fitChart`, no title, layout-dependent height.
- `src/bandsUi.ts`, `src/designUi.ts` — new markup classes; slot rows always show Load/Clear.
- `src/design/main.ts` (moved from `src/main.ts`), `src/correct/main.ts`, `src/correct/previewChart.ts` (new).
- `index.html` (start page), `design.html`, `correct.html` (new), `vite.config.ts`, `src/style.css` (rewritten).
- Deleted: `src/correctionUi.ts`, `src/main.ts`.
- `scripts/page-ids.test.ts` (new), `scripts/acceptance.local.test.ts` (updated).

---

### Task 1: Design page stops applying corrections

The single page keeps working, but without the measured-correction step; the download summary becomes a checklist.

**Files:**
- Modify: `src/ady.ts`, `src/ady.test.ts`, `src/downloadSummary.ts`, `src/downloadSummary.test.ts`, `src/main.ts`, `index.html`, `src/style.css`
- Create: `src/ui/checklist.ts`
- Delete: `src/correctionUi.ts`

**Interfaces:**
- Produces: `applyCurveToAdy(ady: AdyFile, params: CurveParams): AdyFile`; `interface ChecklistItem { text: string; on: boolean }`; `designChecklist(params: CurveParams, subIds: readonly string[], subTrimShift: number): ChecklistItem[]`; `buildFilenameSuffix(params: CurveParams): string`; `renderChecklist(list: HTMLElement, items: readonly ChecklistItem[]): void`.

- [ ] **Step 1: Rewrite the download summary tests**

Replace the whole of `src/downloadSummary.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { buildFilenameSuffix, designChecklist } from './downloadSummary';
import { testParams } from './fixtures/testParams';

const DEFAULT_CURVE = '0.7 dB/oct tilt (held below 50 Hz), +1.43 dB low shelf at 66.5 Hz';

describe('designChecklist', () => {
  it('lists the curve, the cancelled rolloff and the sub trim for the default design', () => {
    expect(designChecklist(testParams(), ['SW1'], 6.27)).toEqual([
      { text: `Curve: ${DEFAULT_CURVE}`, on: true },
      { text: 'HF rolloff 2 cancelled', on: true },
      { text: 'Sub trim +6.27 dB on SW1', on: true },
    ]);
  });

  it('marks a rolloff that is left on', () => {
    expect(designChecklist(testParams({ rolloffType: 1, cancelRolloff: false }), ['SW1'], 0)[1]).toEqual({
      text: 'HF rolloff 1 left on',
      on: false,
    });
  });

  it('marks a skipped sub trim', () => {
    expect(designChecklist(testParams({ subTrim: false }), ['SW1'], 6.27)[2]).toEqual({
      text: 'Sub trim skipped',
      on: false,
    });
  });

  it('says when there is no subwoofer', () => {
    expect(designChecklist(testParams(), [], 6.27)[2]).toEqual({ text: 'No subwoofer, so no sub trim', on: false });
  });

  it('names every sub', () => {
    expect(designChecklist(testParams(), ['SW1', 'SW2'], 1.5)[2].text).toBe('Sub trim +1.5 dB on SW1, SW2');
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
    expect(designChecklist(params, ['SW1'], 0)[0].text).toBe(
      'Curve: 1 dB/oct tilt, -2 dB high shelf at 8000 Hz, -3 dB bell at 3000 Hz (Q 1.4)'
    );
  });

  it('says flat when there are no enabled bands', () => {
    expect(designChecklist(testParams({ bands: [] }), ['SW1'], 0)[0].text).toBe('Curve: flat');
  });
});

describe('buildFilenameSuffix', () => {
  it('is empty for the default settings', () => {
    expect(buildFilenameSuffix(testParams())).toBe('');
  });

  it('orders the suffixes no-knee-cancel, no-sub-trim', () => {
    expect(buildFilenameSuffix(testParams({ cancelRolloff: false, subTrim: false }))).toBe(
      '_no-knee-cancel_no-sub-trim'
    );
  });

  it('adds only what applies', () => {
    expect(buildFilenameSuffix(testParams({ subTrim: false }))).toBe('_no-sub-trim');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/downloadSummary.test.ts`
Expected: FAIL (`designChecklist` is not exported).

- [ ] **Step 3: Implement the checklist**

In `src/downloadSummary.ts`, replace everything from the `/**\n * One-line description` comment to the end of the file with:

```ts
/** One line of a download checklist; `on: false` lines are shown as "not applied". */
export interface ChecklistItem {
  text: string;
  on: boolean;
}

/** What the Design page's download will contain, one fact per line. */
export function designChecklist(
  params: CurveParams,
  subIds: readonly string[],
  subTrimShift: number
): ChecklistItem[] {
  const enabled = params.bands.filter((b) => b.enabled);
  const curve = enabled.length > 0 ? enabled.map(describeBand).join(', ') : 'flat';
  const items: ChecklistItem[] = [{ text: `Curve: ${curve}`, on: true }];
  items.push(
    params.cancelRolloff
      ? { text: `HF rolloff ${params.rolloffType} cancelled`, on: true }
      : { text: `HF rolloff ${params.rolloffType} left on`, on: false }
  );
  if (subIds.length === 0) items.push({ text: 'No subwoofer, so no sub trim', on: false });
  else if (params.subTrim) items.push({ text: `Sub trim ${signed(subTrimShift)} dB on ${subIds.join(', ')}`, on: true });
  else items.push({ text: 'Sub trim skipped', on: false });
  return items;
}

/** Filename suffix that tells test variants apart from the normal export. */
export function buildFilenameSuffix(params: CurveParams): string {
  return (params.cancelRolloff ? '' : '_no-knee-cancel') + (params.subTrim ? '' : '_no-sub-trim');
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/downloadSummary.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Drop trims from `applyCurveToAdy`**

In `src/ady.test.ts`:
- Delete the whole `describe('applyCurveToAdy with per-channel trims', …)` block and the whole `describe('hasAppliedTrims', …)` block.
- Replace the two import lines that follow the first `describe('isSubwooferChannel'…)` block with:

```ts
import { applyCurveToAdy, looksAlreadyProcessed, serializeAdy } from './ady';
import { computeTrimShift, designGain, frequencyGrid } from './curve';
import { testParams, tiltBands } from './fixtures/testParams';
```

In `src/ady.ts`:
- Change the first import to `import { frequencyGrid, writtenGain, computeTrimShift, type CurveParams } from './curve';`
- Replace `applyCurveToAdy` (its doc comment and body) and delete `hasAppliedTrims` (its doc comment and body), putting this in their place:

```ts
/**
 * Returns a new AdyFile with the designed curve written to every channel and
 * enTargetCurveType set to the selected HF rolloff type. When params.subTrim
 * is on, subwoofer trim is compensated; when off, the sub's trimAdjustment is
 * left exactly as it was. Does not mutate the input.
 */
export function applyCurveToAdy(ady: AdyFile, params: CurveParams): AdyFile {
  const clone = JSON.parse(JSON.stringify(ady)) as AdyFile;
  const sharedPoints = frequencyGrid().map((f) => formatPoint(f, writtenGain(f, params)));
  const trimShift = computeTrimShift(params);

  for (const channel of clone.detectedChannels) {
    channel.customTargetCurvePoints = sharedPoints;
    if (isSubwooferChannel(channel) && params.subTrim) {
      const originalTrim = parseFloat(channel.trimAdjustment);
      channel.trimAdjustment = (originalTrim + trimShift).toFixed(6);
    }
  }

  clone.enTargetCurveType = params.rolloffType;
  return clone;
}
```

- [ ] **Step 6: Add the checklist renderer**

Create `src/ui/checklist.ts`:

```ts
import type { ChecklistItem } from '../downloadSummary';

/** Fills `list` (a <ul class="checklist">) with one <li> per item; `on: false` items get the "off" style. */
export function renderChecklist(list: HTMLElement, items: readonly ChecklistItem[]): void {
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      li.textContent = item.text;
      li.classList.toggle('off', !item.on);
      return li;
    })
  );
}
```

- [ ] **Step 7: Remove the correction step from the page**

Delete `src/correctionUi.ts` (`git rm src/correctionUi.ts`).

In `index.html`:
- Delete the `<table id="channel-summary">…</table>` element and the `<p id="no-subwoofer-warning" …>…</p>` that follows it (both inside `#editor`).
- Delete the whole `<section id="measured-correction" class="step">…</section>`.
- Delete the whole `<dialog id="generate-dialog">…</dialog>`.
- Replace the download placeholder and download section with:

```html
      <p id="download-placeholder" class="placeholder">3. Download — available once a .ady is loaded.</p>
      <section id="download-section" class="step" hidden>
        <h2 class="step-heading"><span class="step-num">3</span> Download</h2>
        <ul id="download-summary" class="checklist"></ul>
        <p id="no-subwoofer-warning" class="warning" hidden>
          No subwoofer channel detected, so there is no sub trim to compensate.
        </p>
        <button id="download">Download .ady</button>
      </section>
```

Append to `src/style.css`:

```css
.checklist {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
}

.checklist li::before {
  content: '✓';
  display: inline-block;
  width: 1.4rem;
  font-weight: 700;
}

.checklist li.off::before {
  content: '—';
  color: #aaa;
}
```

- [ ] **Step 8: Rewrite `src/main.ts`**

Replace the whole file with:

```ts
import {
  parseAdy,
  isSubwooferChannel,
  applyCurveToAdy,
  looksAlreadyProcessed,
  serializeAdy,
  AdyValidationError,
  type AdyFile,
} from './ady';
import { initBandsUi } from './bandsUi';
import { sumBands, validateBands, type Band } from './bands';
import { createChart, slotCurveData, updateChart } from './chart';
import { initDesignUi } from './designUi';
import { buildFilenameSuffix, designChecklist } from './downloadSummary';
import { computeTrimShift, subTrimPeakAboveSub, type CurveParams } from './curve';
import { DEFAULT_PRESET_NAME, presetBands } from './presets';
import { isRolloffType } from './rolloff';
import { SLOT_IDS, createSlots } from './slots';
import { renderChecklist } from './ui/checklist';

let currentAdy: AdyFile | null = null;
let chart: ReturnType<typeof createChart> | null = null;

const params: CurveParams = {
  bands: presetBands(DEFAULT_PRESET_NAME),
  rolloffType: 2,
  cancelRolloff: true,
  subTrim: true,
};

const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const errorMessage = document.getElementById('error-message') as HTMLElement;
const editor = document.getElementById('editor') as HTMLElement;
const chartContainer = document.getElementById('chart') as HTMLElement;
const cancelRolloffInput = document.getElementById('cancel-rolloff') as HTMLInputElement;
const rolloffTypeSelect = document.getElementById('rolloff-type') as HTMLSelectElement;
const rolloffNotice = document.getElementById('rolloff-notice') as HTMLElement;
const subTrimInput = document.getElementById('sub-trim') as HTMLInputElement;
const subTrimNotice = document.getElementById('sub-trim-notice') as HTMLElement;
const subTrimPeak = document.getElementById('sub-trim-peak') as HTMLElement;
const noSubwooferWarning = document.getElementById('no-subwoofer-warning') as HTMLElement;
const downloadSection = document.getElementById('download-section') as HTMLElement;
const downloadSummary = document.getElementById('download-summary') as HTMLElement;
const editorPlaceholder = document.getElementById('editor-placeholder') as HTMLElement;
const downloadPlaceholder = document.getElementById('download-placeholder') as HTMLElement;
const downloadButton = document.getElementById('download') as HTMLButtonElement;
const bandError = document.getElementById('band-error') as HTMLElement;
const bandLevel = document.getElementById('band-level') as HTMLElement;
const bandsUi = initBandsUi(params, () => onParamsChanged());
const slots = createSlots();

/** Swaps in a whole new design (preset-like), refreshing the rows, the cancel checkbox and the page. */
function replaceDesign(bands: Band[], cancelRolloff: boolean | undefined, note: string): void {
  params.bands = bands;
  if (cancelRolloff !== undefined) {
    params.cancelRolloff = cancelRolloff;
    cancelRolloffInput.checked = cancelRolloff;
  }
  bandsUi.setNote(note);
  bandsUi.render();
  onParamsChanged();
}

const designUi = initDesignUi({ params, slots, replaceDesign, onSlotsChanged: () => onParamsChanged() });

function showError(message: string): void {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  editor.hidden = true;
  downloadSection.hidden = true;
  editorPlaceholder.hidden = false;
  downloadPlaceholder.hidden = false;
}

function clearError(): void {
  errorMessage.hidden = true;
}

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

function loadFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    try {
      currentAdy = parseAdy(text);
      applyFileDefaults(currentAdy);
      clearError();
      editor.hidden = false;
      downloadSection.hidden = false;
      editorPlaceholder.hidden = true;
      downloadPlaceholder.hidden = true;
      if (!chart) {
        chart = createChart(chartContainer, params, {
          // a handle drag edits params.bands in place: sync the rows and everything else
          onBandsDragged: () => {
            bandsUi.setNote('');
            bandsUi.render();
            onParamsChanged();
          },
        });
      }
      bandsUi.render();
      onParamsChanged();
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

function renderDownloadSummary(): void {
  if (!currentAdy) return;
  const subIds = currentAdy.detectedChannels.filter(isSubwooferChannel).map((c) => c.commandId);
  renderChecklist(downloadSummary, designChecklist(params, subIds, computeTrimShift(params)));
  noSubwooferWarning.hidden = subIds.length > 0;
}

/** Explains a sub trim that comes from a peak above the sub's range (e.g. the boost that cancels the HF rolloff). */
function renderSubTrimPeak(): void {
  const peak = params.subTrim ? subTrimPeakAboveSub(params) : null;
  subTrimPeak.hidden = peak === null;
  if (peak !== null) {
    subTrimPeak.textContent = `The sub trim is ${peak.gain > 0 ? '+' : ''}${peak.gain.toFixed(2)} dB, set by the highest point of the written curve, at ${peak.freq} Hz, well above the sub's range. If the sub ends up too loud, untick "Compensate sub trim".`;
  }
}

function onParamsChanged(): void {
  const problem = validateBands(params.bands);
  bandError.textContent = problem ?? '';
  bandError.hidden = problem === null;
  downloadButton.disabled = problem !== null;
  if (problem !== null) {
    // keep the last good chart; nothing is exported meanwhile (a redraw hides the chart handles)
    chart?.redraw(false, false);
    bandLevel.textContent = '';
    subTrimPeak.hidden = true;
    renderChecklist(downloadSummary, [
      { text: 'Fix the band values above to see what the download will contain.', on: false },
    ]);
    return;
  }
  designUi.clearError(); // a "fix the band values" message from saving no longer applies
  renderSubTrimPeak();
  bandLevel.textContent = `Level at 20 Hz: ${sumBands(20, params.bands).toFixed(2)} dB`;
  if (chart) updateChart(chart, params, SLOT_IDS.map((id) => slotCurveData(slots.get(id), params)));
  renderDownloadSummary();
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

cancelRolloffInput.addEventListener('change', () => {
  params.cancelRolloff = cancelRolloffInput.checked;
  onParamsChanged();
});

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

downloadButton.addEventListener('click', () => {
  if (!currentAdy) return;
  if (validateBands(params.bands) !== null) return;
  const result = applyCurveToAdy(currentAdy, params);
  const blob = new Blob([serializeAdy(result)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  // distinct names so test variants can't be mistaken for the normal file
  const suffix = buildFilenameSuffix(params);
  a.href = url;
  a.download =
    typeof result.title === 'string' && result.title.length > 0
      ? `${result.title}_corrected${suffix}.ady`
      : `corrected${suffix}.ady`;
  a.click();
  URL.revokeObjectURL(url);
});

onParamsChanged();
```

- [ ] **Step 9: Verify and commit**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: tsc clean; all tests pass (the correction/generate tests are untouched and still pass).

Check every id the page scripts look up exists in `index.html`:

```bash
python3 - <<'EOF'
import re,glob
html=open('index.html').read()
ids=set(re.findall(r'id="([^"]+)"',html))
for f in ['src/main.ts','src/bandsUi.ts','src/designUi.ts']:
    for m in re.findall(r"(?:getElementById|el(?:<[^>]*>)?)\('([^']+)'\)",open(f).read()):
        if m not in ids: print('missing',f,m)
print('checked')
EOF
```
Expected: only `checked`.

```bash
git add -A src index.html
git commit -m "feat: drop the measured correction from the design flow; checklist download summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Correction maths: 1 kHz anchor and pin, in-memory model, `measureCorrection`

**Files:**
- Create: `src/curvePoints.ts`
- Modify: `src/measuredError.ts`, `src/measuredError.test.ts`, `src/correction.ts`, `src/correction.test.ts`, `src/generate.ts`, `src/generate.test.ts`, `scripts/acceptance.local.test.ts`

**Interfaces:**
- Consumes: `logGrid`, `computeError`, `rmsOver` from `measuredError.ts`; `parseRewText` from `rewParse.ts`.
- Produces:
  - `readCurvePoints(channel: AdyChannel): { freqs: number[]; gains: number[] }`, `class TargetParseError` (in `curvePoints.ts`, re-exported from `measuredError.ts`).
  - `ANCHOR_HZ = 1000` (in `measuredError.ts`).
  - `interface ChannelCorrection { positions: number; error: number[] }`, `type Correction = Record<string, ChannelCorrection>`, `DEFAULT_CUTOFF_HZ = 500`, `MIN_CUTOFF_HZ = 100`, `MAX_CUTOFF_HZ = 18000`, `trimFromError(error, freq, cutoffHz): TrimFn`, `buildChannelTrims(correction: Correction, cutoffHz: number): Map<string, TrimFn>`, `summarizeCorrection(correction: Correction, cutoffHz: number): TrimSummaryRow[]` with `TrimSummaryRow { commandId; positions; maxAbsTrim }`.
  - `measureCorrection(ady: AdyFile, speakers: readonly SpeakerInput[]): MeasuredResult` with `MeasuredResult { correction: Correction; reports: ChannelReport[]; warnings: string[] }`; `checkMeasuredType`, `GenerateError`, `SpeakerInput`, `ChannelReport` unchanged.

- [ ] **Step 1: Write the new correction tests**

Replace the whole of `src/correction.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CUTOFF_HZ,
  MAX_CUTOFF_HZ,
  MIN_CUTOFF_HZ,
  buildChannelTrims,
  summarizeCorrection,
  trimFromError,
  type Correction,
} from './correction';
import { logGrid } from './measuredError';

const freq = logGrid();
/** 0 up to 1.5 kHz and `v` above: zero around the 1 kHz pin, so above the fade the trim is exactly -v. */
const shelf = (v: number) => freq.map((f) => (f >= 1500 ? v : 0));

describe('cutoff constants', () => {
  it('defaults to 500 Hz and allows 100-18000 Hz', () => {
    expect(DEFAULT_CUTOFF_HZ).toBe(500);
    expect(MIN_CUTOFF_HZ).toBe(100);
    expect(MAX_CUTOFF_HZ).toBe(18000);
  });
});

describe('trimFromError', () => {
  it('rejects a cutoff that is not a positive finite number', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => trimFromError(shelf(1), freq, bad)).toThrow(/cutoff/i);
    }
  });

  it('is zero below the fade, half at the cutoff and full above it', () => {
    const trim = trimFromError(shelf(2), freq, 4000);
    expect(trim(2000)).toBeCloseTo(0, 6);
    expect(trim(4000)).toBeCloseTo(-1, 1);
    expect(trim(5800)).toBeCloseTo(-2, 2);
    expect(trim(10000)).toBeCloseTo(-2, 6);
    expect(trim(20000)).toBeCloseTo(-2, 6);
  });

  it('is the negative of the error (a positive error gives a cut, a negative one a boost)', () => {
    expect(trimFromError(shelf(-2), freq, 4000)(10000)).toBeCloseTo(2, 6);
  });

  it('clamps to +/-3 dB', () => {
    expect(trimFromError(shelf(10), freq, 4000)(10000)).toBeCloseTo(-3, 6);
    expect(trimFromError(shelf(-10), freq, 4000)(10000)).toBeCloseTo(3, 6);
  });

  it('moves the fade with the cutoff', () => {
    const trim = trimFromError(shelf(2), freq, 8000);
    expect(trim(4000)).toBeCloseTo(0, 6);
    expect(trim(16000)).toBeCloseTo(-2, 6);
  });

  it('smooths a single-point spike instead of chasing it', () => {
    const error = freq.map(() => 0);
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

  it('removes a pure level offset: a flat error gives no correction', () => {
    const trim = trimFromError(freq.map(() => 2.5), freq, 300);
    for (const f of freq) expect(Math.abs(trim(f))).toBeLessThan(1e-9);
  });

  it('lines the correction up at 1 kHz, not at the average level', () => {
    // 1 dB up to 1.5 kHz and 3 dB above: relative to 1 kHz the treble is 2 dB hot
    const error = freq.map((f) => (f >= 1500 ? 3 : 1));
    expect(trimFromError(error, freq, 4000)(10000)).toBeCloseTo(-2, 6);
  });

  it('pins the correction to 0 at 1 kHz for cutoffs below the octave around it', () => {
    const sloped = freq.map((f) => Math.log2(f / 200)); // about 2.3 dB at 1 kHz and changing through it
    for (const cutoff of [100, 300, 500, 700]) {
      expect(Math.abs(trimFromError(sloped, freq, cutoff)(1000))).toBeLessThan(0.01);
    }
  });
});

describe('buildChannelTrims / summarizeCorrection', () => {
  const correction: Correction = {
    FL: { positions: 3, error: shelf(2) },
    FR: { positions: 2, error: shelf(-1) },
  };

  it('builds one trim function per channel', () => {
    const trims = buildChannelTrims(correction, 4000);
    expect([...trims.keys()].sort()).toEqual(['FL', 'FR']);
    expect(trims.get('FL')!(10000)).toBeCloseTo(-2, 6);
    expect(trims.get('FR')!(10000)).toBeCloseTo(1, 6);
  });

  it('summarises positions and the largest trim per channel', () => {
    const fl = summarizeCorrection(correction, 4000).find((r) => r.commandId === 'FL')!;
    expect(fl.positions).toBe(3);
    expect(fl.maxAbsTrim).toBeCloseTo(2, 6);
  });

  it('reports a smaller largest trim for a higher cutoff', () => {
    const low = summarizeCorrection(correction, 4000)[0].maxAbsTrim;
    const none = summarizeCorrection(correction, 60000)[0].maxAbsTrim;
    expect(low).toBeGreaterThan(none);
  });
});
```

In `src/measuredError.test.ts`, replace the test `it('preserves shape and zeroes the 500-1500 Hz mean', …)` with:

```ts
  it('preserves shape and zeroes the mean over the octave around 1 kHz', () => {
    const grid = logGrid();
    const curve = grid.map((_, i) => 73 + i * 0.01);
    const out = normalizeLevel(curve);
    expect(out[10] - out[0]).toBeCloseTo(0.1, 9);
    const band = out.filter((_, i) => grid[i] >= 1000 / Math.SQRT2 && grid[i] <= 1000 * Math.SQRT2);
    expect(band.reduce((a, b) => a + b, 0) / band.length).toBeCloseTo(0, 9);
  });
```

and in the same file change the comment `// both are ~0 dB across 500-1500 Hz, so level normalisation shifts them equally` to `// both are ~0 dB around 1 kHz, so level normalisation shifts them equally`.

- [ ] **Step 2: Rewrite the generate tests**

Replace the whole of `src/generate.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import type { AdyFile } from './ady';
import { createSampleAdy } from './fixtures/sampleAdy';
import { synthRewText } from './fixtures/synthMeasurement';
import { GenerateError, checkMeasuredType, measureCorrection } from './generate';
import { rolloffGain } from './rolloff';
import { logGrid } from './measuredError';
import { RewParseError } from './rewParse';

/** A flat (0 dB) custom curve on the log grid. */
const FLAT = logGrid().map((f) => `{${f.toFixed(3)}, 0.000}`);

function measuredAdy(): AdyFile {
  const ady = createSampleAdy(); // FL and SW1
  ady.enTargetCurveType = 2;
  ady.detectedChannels[0].customTargetCurvePoints = [...FLAT];
  ady.detectedChannels.push({ commandId: 'FR', customTargetCurvePoints: [...FLAT], trimAdjustment: '0.000000' });
  return ady;
}

// The target is flat + knee, so "flat + knee + bump" measures as an error equal to the bump.
const bump = (f: number) => 1.5 * Math.exp(-(Math.log2(f / 8000) ** 2) / (2 * 0.3 ** 2));
const measuredFn = (f: number) => 70 + rolloffGain(2, f) + bump(f);
const file = (name: string, fn = measuredFn) => ({ name, text: synthRewText(fn) });
const at8k = () => logGrid().findIndex((f) => f >= 8000);

describe('measureCorrection', () => {
  it('measures the planted error with the averaged position count', () => {
    const { correction, reports, warnings } = measureCorrection(measuredAdy(), [
      { commandId: 'FL', files: [file('L1.txt'), file('L2.txt')] },
    ]);
    expect(Object.keys(correction)).toEqual(['FL']);
    expect(correction.FL.positions).toBe(2);
    expect(correction.FL.error[at8k()]).toBeCloseTo(1.5, 1);
    expect(reports).toHaveLength(1);
    expect(reports[0].commandId).toBe('FL');
    expect(reports[0].positions).toBe(2);
    expect(Number.isFinite(reports[0].rmsError)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('accepts REW files that carry a phase column', () => {
    const phased = { name: 'L1.txt', text: synthRewText(measuredFn, 1500, true) };
    expect(measureCorrection(measuredAdy(), [{ commandId: 'FL', files: [phased] }]).correction.FL.positions).toBe(1);
  });

  it('skips speakers with no files but processes the others', () => {
    const { correction } = measureCorrection(measuredAdy(), [
      { commandId: 'FL', files: [file('L1.txt')] },
      { commandId: 'FR', files: [] },
    ]);
    expect(Object.keys(correction)).toEqual(['FL']);
  });

  it('refuses a .ady with an unsupported enTargetCurveType', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 0;
    const run = () => measureCorrection(ady, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/enTargetCurveType 0/);
  });

  it('uses the Roll Off 1 shape for a type-1 .ady', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 1;
    const one = (f: number) => 70 + rolloffGain(1, f) + bump(f);
    const { correction, warnings } = measureCorrection(ady, [{ commandId: 'FL', files: [file('L1.txt', one)] }]);
    expect(correction.FL.error[at8k()]).toBeCloseTo(1.5, 1);
    expect(warnings).toEqual([]);
  });

  it('a Roll Off 2 measurement read as type 1 shows the difference between the shapes', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 1;
    const { correction } = measureCorrection(ady, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    // 12.5 kHz: Roll Off 2 is about 1.5 dB lower than Roll Off 1 there, and the 8 kHz test bump is negligible
    expect(correction.FL.error[logGrid().findIndex((f) => f >= 12500)]).toBeLessThan(-1);
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

  it('refuses a speaker whose channel has no target curve', () => {
    const ady = measuredAdy();
    ady.detectedChannels[0].customTargetCurvePoints = [];
    const run = () => measureCorrection(ady, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/FL has no target curve/);
  });

  it('throws when no speaker has any files', () => {
    expect(() => measureCorrection(measuredAdy(), [])).toThrow(GenerateError);
    expect(() => measureCorrection(measuredAdy(), [{ commandId: 'FL', files: [] }])).toThrow(/No measurement files/);
  });

  it('throws for a channel the .ady does not have', () => {
    expect(() => measureCorrection(measuredAdy(), [{ commandId: 'XX', files: [file('a.txt')] }])).toThrow(/XX/);
  });

  it('throws for the subwoofer', () => {
    expect(() => measureCorrection(measuredAdy(), [{ commandId: 'SW1', files: [file('a.txt')] }])).toThrow(
      /subwoofer/
    );
  });

  it('throws when a channel is given twice', () => {
    expect(() =>
      measureCorrection(measuredAdy(), [
        { commandId: 'FL', files: [file('a.txt')] },
        { commandId: 'FL', files: [file('b.txt')] },
      ])
    ).toThrow(/twice/);
  });

  it('warns when a speaker looks far off, without blocking', () => {
    const wild = (f: number) => 70 + rolloffGain(2, f) + (f > 3000 ? 10 : 0);
    const { correction, warnings } = measureCorrection(measuredAdy(), [
      { commandId: 'FL', files: [file('L1.txt', wild)] },
    ]);
    expect(correction.FL).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/FL/);
  });

  it('lets a parse error through, naming the file', () => {
    const run = () =>
      measureCorrection(measuredAdy(), [{ commandId: 'FL', files: [{ name: 'L3.txt', text: 'garbage' }] }]);
    expect(run).toThrow(RewParseError);
    expect(run).toThrow(/L3\.txt/);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/correction.test.ts src/generate.test.ts src/measuredError.test.ts`
Expected: FAIL (missing exports `MIN_CUTOFF_HZ`, `measureCorrection`; the 1 kHz normalisation test fails).

- [ ] **Step 4: Move point parsing to `src/curvePoints.ts`**

Create `src/curvePoints.ts`:

```ts
import type { AdyChannel } from './ady';

/** Thrown when a channel's customTargetCurvePoints can't be read. */
export class TargetParseError extends Error {}

const POINT_PATTERN = /^\{\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\}$/;

/**
 * A channel's written curve as ascending frequencies (Hz) and their gains (dB).
 * Both are empty when the channel has no custom points.
 */
export function readCurvePoints(channel: AdyChannel): { freqs: number[]; gains: number[] } {
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
  return { freqs: points.map((p) => p.freq), gains: points.map((p) => p.gain) };
}
```

In `src/measuredError.ts`:
- Add `import { readCurvePoints } from './curvePoints';` to the imports and add `export { TargetParseError } from './curvePoints';` below them.
- Replace the constants `NORMALIZE_LO_HZ = 500` and `NORMALIZE_HI_HZ = 1500` with:

```ts
/** Measurements and targets are lined up at 1 kHz: over the octave centred on it. */
export const ANCHOR_HZ = 1000;
const NORMALIZE_LO_HZ = ANCHOR_HZ / Math.SQRT2;
const NORMALIZE_HI_HZ = ANCHOR_HZ * Math.SQRT2;
```

- Change the `normalizeLevel` doc comment to `/** Subtracts the mean level over the octave around 1 kHz so only shape is left. */`.
- Delete the `/** Thrown when a channel's customTargetCurvePoints can't be read. */ export class TargetParseError …` declaration and the `POINT_PATTERN` constant.
- Replace `writtenCurve` with:

```ts
/** The channel's written curve (dB) on the grid; all zeros when it has no custom points. */
function writtenCurve(channel: AdyChannel): number[] {
  const grid = logGrid();
  const { freqs, gains } = readCurvePoints(channel);
  if (freqs.length === 0) return grid.map(() => 0);
  return grid.map((f) => interpLogFreq(freqs, gains, f));
}
```

- [ ] **Step 5: Rewrite `src/correction.ts`**

Replace the whole file with:

```ts
import { smoothstep, type TrimFn } from './curve';
import { interpLogFreq } from './logInterp';
import { ANCHOR_HZ, logGrid } from './measuredError';

/** One speaker's measured error on the shared log grid (`logGrid()`). */
export interface ChannelCorrection {
  /** How many measurement positions were averaged into `error`. */
  positions: number;
  /** measured - target (dB) at each grid point, lined up at 1 kHz. */
  error: number[];
}

/** Measured errors per channel (commandId). Kept in memory only. */
export type Correction = Record<string, ChannelCorrection>;

export const DEFAULT_CUTOFF_HZ = 500;
export const MIN_CUTOFF_HZ = 100;
export const MAX_CUTOFF_HZ = 18000;

/** Grid points either side of centre for the 1-octave box smoothing (24 points per octave). */
const SMOOTH_HALF_WIDTH_POINTS = 12;
const TRIM_CLAMP_DB = 3;
/** The trim fades in over this many octaves, centred on the cutoff. */
const FADE_WIDTH_OCTAVES = 1;

/**
 * Turns a measured error curve into a trim: 1-octave smoothing, re-pin so the
 * smoothed error is 0 at 1 kHz (each curve keeps its value there), clamp to
 * +/-3 dB, fade in around the cutoff, negate. The returned function looks the
 * trim up by log-frequency interpolation between `freq` points.
 */
export function trimFromError(error: readonly number[], freq: readonly number[], cutoffHz: number): TrimFn {
  if (!Number.isFinite(cutoffHz) || cutoffHz <= 0) {
    throw new Error(`Cutoff must be a positive finite frequency, got ${cutoffHz}`);
  }
  const n = error.length;
  const smoothed = error.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - SMOOTH_HALF_WIDTH_POINTS; j <= i + SMOOTH_HALF_WIDTH_POINTS; j++) {
      sum += error[Math.min(n - 1, Math.max(0, j))];
      count++;
    }
    return sum / count;
  });
  const pin = interpLogFreq(freq, smoothed, ANCHOR_HZ);
  const trims = smoothed.map((value, i) => {
    const clamped = Math.max(-TRIM_CLAMP_DB, Math.min(TRIM_CLAMP_DB, value - pin));
    const weight = smoothstep(Math.log2(freq[i] / cutoffHz) / FADE_WIDTH_OCTAVES + 0.5);
    return -weight * clamped;
  });
  return (f: number) => interpLogFreq(freq, trims, f);
}

/** One trim function per channel in the correction, for the given cutoff. */
export function buildChannelTrims(correction: Correction, cutoffHz: number): Map<string, TrimFn> {
  const freq = logGrid();
  const trims = new Map<string, TrimFn>();
  for (const [id, channel] of Object.entries(correction)) {
    trims.set(id, trimFromError(channel.error, freq, cutoffHz));
  }
  return trims;
}

export interface TrimSummaryRow {
  commandId: string;
  positions: number;
  maxAbsTrim: number;
}

export function summarizeCorrection(correction: Correction, cutoffHz: number): TrimSummaryRow[] {
  const freq = logGrid();
  return Object.entries(correction).map(([commandId, channel]) => {
    const trim = trimFromError(channel.error, freq, cutoffHz);
    let maxAbsTrim = 0;
    for (const f of freq) maxAbsTrim = Math.max(maxAbsTrim, Math.abs(trim(f)));
    return { commandId, positions: channel.positions, maxAbsTrim };
  });
}
```

- [ ] **Step 6: Rewrite `generateCorrection` as `measureCorrection`**

In `src/generate.ts`:
- Change the second import to `import type { ChannelCorrection, Correction } from './correction';`
- Replace `interface GenerateResult` (and everything after it) with:

```ts
export interface MeasuredResult {
  correction: Correction;
  reports: ChannelReport[];
  warnings: string[];
}

/**
 * Measures each speaker's error from REW exports against the curve in `ady`,
 * the .ady that was loaded on the AVR for the sweeps (it supplies each
 * channel's target and the HF rolloff type). Speakers with no files are
 * skipped; a speaker's channel must already carry a custom target curve.
 */
export function measureCorrection(ady: AdyFile, speakers: readonly SpeakerInput[]): MeasuredResult {
  const rolloffType = checkMeasuredType(ady);
  const active = speakers.filter((s) => s.files.length > 0);
  if (active.length === 0) throw new GenerateError('No measurement files were given.');

  const correction: Correction = {};
  const reports: ChannelReport[] = [];
  const warnings: string[] = [];

  for (const speaker of active) {
    const channel = ady.detectedChannels.find((c) => c.commandId === speaker.commandId);
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

    const measurements = speaker.files.map((f) => parseRewText(f.text, f.name));
    const error = computeError(measurements, channel, rolloffType);
    const rmsError = rmsOver(error, 2000, 20000);
    const entry: ChannelCorrection = { positions: measurements.length, error };

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

- [ ] **Step 7: Update the local acceptance test**

Replace the whole of `scripts/acceptance.local.test.ts` with:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAdy } from '../src/ady';
import { DEFAULT_CUTOFF_HZ, buildChannelTrims } from '../src/correction';
import { measureCorrection } from '../src/generate';
import { logGrid } from '../src/measuredError';

/**
 * Opt-in check against a real measurement session (never committed; needs your own files).
 * Skipped unless both variables are set:
 *
 *   REAL_ADY       the .ady whose filters were loaded on the AVR for the REW sweeps
 *   REAL_DATA_DIR  a folder of REW text exports named "<speaker> Pos<N>.txt"
 *                  (speaker: L, R, C, BL, BR)
 *
 *   REAL_ADY=/path/Tilted.ady REAL_DATA_DIR=/path/folder npx vitest run scripts/acceptance.local.test.ts
 *
 * The checks are deliberately shape-agnostic: they hold for any target curve and
 * either HF rolloff type, and only look for a correction that is sane.
 */
const adyPath = process.env.REAL_ADY;
const dir = process.env.REAL_DATA_DIR;
// BL/BR are assumed to be the surround-back speakers' SLA/SRA channels
const SPEAKERS: Record<string, string> = { L: 'FL', R: 'FR', C: 'C', BL: 'SLA', BR: 'SRA' };

function load() {
  const ady = parseAdy(readFileSync(adyPath as string, 'utf8'));
  const present = readdirSync(dir as string);
  const speakers = Object.entries(SPEAKERS)
    .map(([prefix, commandId]) => ({
      commandId,
      files: present
        .filter((name) => new RegExp(`^${prefix} Pos\\d+\\.txt$`).test(name))
        .map((name) => ({ name, text: readFileSync(join(dir as string, name), 'utf8') })),
    }))
    .filter((s) => s.files.length > 0 && ady.detectedChannels.some((c) => c.commandId === s.commandId));
  return { speakers, result: measureCorrection(ady, speakers) };
}

describe.skipIf(!adyPath || !dir)('local acceptance: real measurement session', () => {
  it('finds speakers and averages every position file it was given', () => {
    const { speakers, result } = load();
    expect(speakers.length).toBeGreaterThan(0);
    for (const s of speakers) expect(result.correction[s.commandId].positions).toBe(s.files.length);
  });

  it('gives no far-off warnings: the target the tool reads back matches what was measured', () => {
    expect(load().result.warnings).toEqual([]);
  });

  it('has a finite error curve on the shared grid for every speaker', () => {
    const { result } = load();
    for (const channel of Object.values(result.correction)) {
      expect(channel.error).toHaveLength(logGrid().length);
      expect(channel.error.every(Number.isFinite)).toBe(true);
    }
  });

  it('keeps every trim within +-3 dB, zero well below the cutoff and pinned at 1 kHz', () => {
    const { result } = load();
    const trims = buildChannelTrims(result.correction, DEFAULT_CUTOFF_HZ);
    for (const trim of trims.values()) {
      for (const f of logGrid()) expect(Math.abs(trim(f))).toBeLessThanOrEqual(3 + 1e-9);
      expect(trim(200)).toBeCloseTo(0, 6);
      expect(Math.abs(trim(1000))).toBeLessThan(0.01);
    }
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: tsc clean; all tests pass. If `REAL_ADY` and `REAL_DATA_DIR` point at local data, also run the acceptance test and report its result (it is not required to pass for this task; report what it prints).

- [ ] **Step 9: Commit**

```bash
git add -A src scripts/acceptance.local.test.ts
git commit -m "feat: anchor and pin measured corrections at 1 kHz; in-memory correction model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Correct-page logic: `applyMeasuredCorrection`, checklist, filename, preview data

**Files:**
- Modify: `src/ady.ts`, `src/ady.test.ts`, `src/downloadSummary.ts`, `src/downloadSummary.test.ts`
- Create: `src/correctionPreview.ts`, `src/correctionPreview.test.ts`

**Interfaces:**
- Consumes: `readCurvePoints` (Task 2), `interpLogFreq`, `trimFromError`, `ChannelCorrection` (Task 2), `effectiveTarget`, `logGrid`, `ChecklistItem` (Task 1).
- Produces: `class MeasuredCorrectionError`; `applyMeasuredCorrection(ady: AdyFile, trims: ReadonlyMap<string, TrimFn>): AdyFile`; `correctChecklist(channels: readonly string[], cutoffHz: number): ChecklistItem[]`; `measuredFilename(title: unknown, cutoffHz: number): string`; `interface PreviewCurves { freq: number[]; current: number[]; measured: number[]; corrected: number[] }`; `previewCurves(channel: AdyChannel, rolloffType: RolloffType, correction: ChannelCorrection, cutoffHz: number): PreviewCurves`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ady.test.ts`:

```ts
import { MeasuredCorrectionError, applyMeasuredCorrection } from './ady';
import type { TrimFn } from './curve';

describe('applyMeasuredCorrection', () => {
  /** FL, SW1 and FR, all carrying the default design on the write grid. */
  function designed() {
    const ady = applyCurveToAdy(createSampleAdy(), testParams());
    ady.detectedChannels.push({
      commandId: 'FR',
      customTargetCurvePoints: [...ady.detectedChannels[0].customTargetCurvePoints],
      trimAdjustment: '0.250000',
    });
    return ady;
  }
  const byId = (ady: ReturnType<typeof designed>, id: string) =>
    ady.detectedChannels.find((c) => c.commandId === id)!;
  const trim: TrimFn = (f) => (f >= 5000 ? -1.5 : 0);
  const gainOf = (point: string) => parseFloat(point.split(',')[1]);
  /** Same rounding as the writer, which prints a negative zero as "0.000". */
  const fmt = (gain: number) => (gain.toFixed(3) === '-0.000' ? '0.000' : gain.toFixed(3));

  it('adds the trim to each point of a channel on the write grid', () => {
    const input = designed();
    const result = applyMeasuredCorrection(input, new Map([['FL', trim]]));
    const before = byId(input, 'FL').customTargetCurvePoints;
    const after = byId(result, 'FL').customTargetCurvePoints;
    const grid = frequencyGrid();
    expect(after).toHaveLength(grid.length);
    after.forEach((point, i) =>
      expect(point).toBe(`{${grid[i].toFixed(1)}, ${fmt(gainOf(before[i]) + trim(grid[i]))}}`)
    );
  });

  it('leaves untrimmed channels, the sub, every trimAdjustment and enTargetCurveType untouched', () => {
    const input = designed();
    input.enTargetCurveType = 1;
    const result = applyMeasuredCorrection(input, new Map([['FL', trim], ['SW1', trim]]));
    expect(byId(result, 'FR')).toEqual(byId(input, 'FR'));
    expect(byId(result, 'SW1')).toEqual(byId(input, 'SW1'));
    expect(byId(result, 'FL').trimAdjustment).toBe(byId(input, 'FL').trimAdjustment);
    expect(result.enTargetCurveType).toBe(1);
    expect(result.title).toBe('Sample');
  });

  it('resamples a curve that is not on the write grid onto it', () => {
    const ady = createSampleAdy();
    ady.detectedChannels[0].customTargetCurvePoints = ['{20.0, 2.000}', '{1000.0, 0.000}', '{20000.0, -2.000}'];
    const points = applyMeasuredCorrection(ady, new Map([['FL', () => 0.5]])).detectedChannels[0]
      .customTargetCurvePoints;
    expect(points).toHaveLength(frequencyGrid().length);
    expect(points[0]).toBe('{20.0, 2.500}');
    expect(points[points.length - 1]).toBe('{20000.0, -1.500}');
    // log-frequency interpolation between 20 Hz (2 dB) and 1 kHz (0 dB)
    const at200 = 2 - (2 * Math.log10(200 / 20)) / Math.log10(1000 / 20) + 0.5;
    expect(points.find((p) => p.startsWith('{200.0,'))).toBe(`{200.0, ${at200.toFixed(3)}}`);
  });

  it('refuses a trimmed channel that has no target curve', () => {
    const run = () => applyMeasuredCorrection(createSampleAdy(), new Map([['FL', trim]]));
    expect(run).toThrow(MeasuredCorrectionError);
    expect(run).toThrow(/FL has no target curve/);
  });

  it('ignores a trim for a channel the file does not have', () => {
    const input = designed();
    expect(applyMeasuredCorrection(input, new Map([['XX', trim]]))).toEqual(input);
  });

  it('changes nothing on a pass with a zero trim', () => {
    const input = designed();
    expect(applyMeasuredCorrection(input, new Map([['FL', () => 0], ['FR', () => 0]]))).toEqual(input);
  });

  it('does not mutate the input', () => {
    const input = designed();
    const snapshot = JSON.stringify(input);
    applyMeasuredCorrection(input, new Map([['FL', trim]]));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
```

Append to `src/downloadSummary.test.ts` (and add `correctChecklist, measuredFilename` to its import from `./downloadSummary`):

```ts
describe('correctChecklist', () => {
  it('names the corrected channels and the cutoff, and says what stays the same', () => {
    expect(correctChecklist(['FL', 'FR', 'C'], 500)).toEqual([
      { text: 'Measured correction on FL, FR, C above 500 Hz', on: true },
      { text: 'Curves unchanged at 1 kHz and below the cutoff', on: true },
      { text: 'Sub, channel levels and HF rolloff unchanged', on: true },
    ]);
  });
});

describe('measuredFilename', () => {
  it('uses the title and the rounded cutoff', () => {
    expect(measuredFilename('Living', 500)).toBe('Living_measured-500Hz.ady');
    expect(measuredFilename('Living', 312.4)).toBe('Living_measured-312Hz.ady');
  });

  it('works without a title', () => {
    expect(measuredFilename(undefined, 500)).toBe('measured-500Hz.ady');
    expect(measuredFilename('', 500)).toBe('measured-500Hz.ady');
  });
});
```

Create `src/correctionPreview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { trimFromError } from './correction';
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

describe('previewCurves', () => {
  it('shows the current target, the measurement and the corrected target on the log grid', () => {
    const curves = previewCurves(channel(), 2, { positions: 1, error }, 500);
    const target = effectiveTarget(channel(), 2);
    const trim = trimFromError(error, grid, 500);
    expect(curves.freq).toEqual(grid);
    curves.current.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
    curves.measured.forEach((v, i) => expect(v).toBeCloseTo(target[i] + error[i], 9));
    curves.corrected.forEach((v, i) => expect(v).toBeCloseTo(target[i] + trim(grid[i]), 9));
  });

  it('leaves the target alone below the fade', () => {
    const curves = previewCurves(channel(), 2, { positions: 1, error }, 4000);
    const i = grid.findIndex((f) => f >= 1000);
    expect(curves.corrected[i]).toBeCloseTo(curves.current[i], 9);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/ady.test.ts src/downloadSummary.test.ts src/correctionPreview.test.ts`
Expected: FAIL (missing exports and module).

- [ ] **Step 3: Implement `applyMeasuredCorrection`**

In `src/ady.ts`:
- Change the first import to `import { frequencyGrid, writtenGain, computeTrimShift, type CurveParams, type TrimFn } from './curve';` and add below it:

```ts
import { readCurvePoints } from './curvePoints';
import { interpLogFreq } from './logInterp';
```

- Replace `formatPoint` with:

```ts
function formatPoint(freq: number, gain: number): string {
  const text = gain.toFixed(3);
  // a value that rounds to zero from below would print "-0.000"; write it as "0.000"
  return `{${freq.toFixed(1)}, ${text === '-0.000' ? '0.000' : text}}`;
}
```

- Add after `applyCurveToAdy`:

```ts
export class MeasuredCorrectionError extends Error {}

/**
 * Returns a new AdyFile with a measured correction added to the curves already
 * in the file. Each non-sub channel that has a trim gets its existing curve,
 * resampled onto the write grid (log-frequency interpolation), plus the trim.
 * Everything else — other channels' points, every trimAdjustment,
 * enTargetCurveType, all other fields — is copied as is. Does not mutate the
 * input. Throws MeasuredCorrectionError for a trimmed channel with no curve.
 */
export function applyMeasuredCorrection(ady: AdyFile, trims: ReadonlyMap<string, TrimFn>): AdyFile {
  const clone = JSON.parse(JSON.stringify(ady)) as AdyFile;
  const grid = frequencyGrid();
  for (const channel of clone.detectedChannels) {
    if (isSubwooferChannel(channel)) continue;
    const trim = trims.get(channel.commandId);
    if (!trim) continue;
    const { freqs, gains } = readCurvePoints(channel);
    if (freqs.length === 0) {
      throw new MeasuredCorrectionError(
        `Channel ${channel.commandId} has no target curve. Design one on the Design page first.`
      );
    }
    channel.customTargetCurvePoints = grid.map((f) => formatPoint(f, interpLogFreq(freqs, gains, f) + trim(f)));
  }
  return clone;
}
```

- [ ] **Step 4: Implement the checklist and filename**

Append to `src/downloadSummary.ts`:

```ts
/** What the Correct page's download will contain. */
export function correctChecklist(channels: readonly string[], cutoffHz: number): ChecklistItem[] {
  return [
    { text: `Measured correction on ${channels.join(', ')} above ${cutoffHz} Hz`, on: true },
    { text: 'Curves unchanged at 1 kHz and below the cutoff', on: true },
    { text: 'Sub, channel levels and HF rolloff unchanged', on: true },
  ];
}

/** Download name for a corrected file, e.g. "Living_measured-500Hz.ady". */
export function measuredFilename(title: unknown, cutoffHz: number): string {
  const name = `measured-${Math.round(cutoffHz)}Hz.ady`;
  return typeof title === 'string' && title.length > 0 ? `${title}_${name}` : name;
}
```

- [ ] **Step 5: Implement the preview data**

Create `src/correctionPreview.ts`:

```ts
import type { AdyChannel } from './ady';
import { trimFromError, type ChannelCorrection } from './correction';
import { effectiveTarget, logGrid } from './measuredError';
import type { RolloffType } from './rolloff';

export interface PreviewCurves {
  freq: number[];
  /** What the file aims for now: its curve plus the HF rolloff. */
  current: number[];
  /** The measured response. */
  measured: number[];
  /** The target after the correction. */
  corrected: number[];
}

/** The Correct page chart's three lines for one channel, all lined up at 1 kHz. */
export function previewCurves(
  channel: AdyChannel,
  rolloffType: RolloffType,
  correction: ChannelCorrection,
  cutoffHz: number
): PreviewCurves {
  const freq = logGrid();
  const current = effectiveTarget(channel, rolloffType);
  const trim = trimFromError(correction.error, freq, cutoffHz);
  return {
    freq,
    current,
    measured: current.map((v, i) => v + correction.error[i]),
    corrected: current.map((v, i) => v + trim(freq[i])),
  };
}
```

- [ ] **Step 6: Run the tests, then commit**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: all pass.

```bash
git add -A src
git commit -m "feat: add the measured-correction export, checklist, filename and preview data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pages, start page and the Design page workbench

**Files:**
- Modify: `vite.config.ts`, `index.html` (becomes the start page), `src/style.css` (rewritten), `src/chart.ts`, `src/bandsUi.ts`, `src/designUi.ts`
- Create: `design.html`, `src/design/main.ts` (moved from `src/main.ts`), `src/ui/filePick.ts`, `scripts/page-ids.test.ts`
- Delete: `src/main.ts`

**Interfaces:**
- Produces: `baseChartOptions(): Pick<uPlot.Options, 'scales' | 'axes' | 'cursor'>`; `fitChart(chart: uPlot, container: HTMLElement): void` (in `chart.ts`); `showFileName(inputId: string, name: string): void`, `bindFileNames(): void` (in `ui/filePick.ts`). Task 5 uses all of these and the CSS classes `.page`, `.site-header`, `.card`, `.card-title`, `.step`, `.step-title`, `.step-num`, `.placeholder`, `.dropzone`, `.file-pick`, `.file-name`, `.workbench`, `.workbench-left`, `.workbench-right`, `.chart-card`, `.field`, `.checklist`, `.gen-row`, `.channel-name`, `.visually-hidden`.

- [ ] **Step 1: Write the page id test**

Create `scripts/page-ids.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

/** Each page and the scripts that look up elements on it. */
const PAGES: Record<string, string[]> = {
  'design.html': ['src/design/main.ts', 'src/bandsUi.ts', 'src/designUi.ts'],
};

const LOOKUPS = [
  /getElementById\(\s*'([^']+)'\s*\)/g,
  /\bel(?:<[^>]*>)?\(\s*'([^']+)'\s*\)/g,
  /querySelector(?:All)?(?:<[^>]*>)?\(\s*'#([\w-]+)/g,
];

describe('page element ids', () => {
  for (const [page, scripts] of Object.entries(PAGES)) {
    it(`${page} has every id its scripts look up`, () => {
      const html = read(page);
      const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      const missing: string[] = [];
      for (const script of scripts) {
        const source = read(script);
        for (const pattern of LOOKUPS) {
          for (const match of source.matchAll(pattern)) {
            if (!ids.has(match[1])) missing.push(`${script}: #${match[1]}`);
          }
        }
      }
      for (const match of html.matchAll(/data-for="([^"]+)"/g)) {
        if (!ids.has(match[1])) missing.push(`${page}: data-for="${match[1]}"`);
      }
      expect(missing).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run scripts/page-ids.test.ts`
Expected: FAIL (`design.html` does not exist).

- [ ] **Step 3: Multi-page build**

Replace `vite.config.ts` with:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  // relative base so the built app works from any GitHub Pages project path
  // without hardcoding the repo name
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: page('./index.html'),
        design: page('./design.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: The start page**

Replace `index.html` with:

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
    <div class="page">
      <header class="site-header">
        <h1>Audyssey Target Curve Editor</h1>
      </header>
      <p class="hint">
        Edit the target curves in an Audyssey MultEQ-X .ady file. Everything runs in your browser; nothing is
        uploaded.
      </p>
      <div class="choices">
        <a class="card choice" href="./design.html">
          <h2>Design a target curve</h2>
          <p>
            Start from the raw .ady from MultEQ-X. Build the curve from presets and bands, compare designs, and
            download the .ady.
          </p>
        </a>
        <a class="card choice" href="./correct.html">
          <h2>Apply a measured correction</h2>
          <p>
            Start from a .ady this tool made, plus REW measurements taken with it loaded on the AVR. Download the
            corrected .ady, and repeat to refine.
          </p>
        </a>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 5: The Design page HTML**

Create `design.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Design a Target Curve · Audyssey Target Curve Editor</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div class="page">
      <header class="site-header">
        <h1><a href="./index.html">Audyssey Target Curve Editor</a></h1>
        <nav><span class="nav-current">Design a curve</span> · <a href="./correct.html">Apply a measured correction</a></nav>
      </header>

      <section class="card">
        <h2 class="step-title"><span class="step-num">1</span> Load your .ady</h2>
        <p class="hint">The raw file from MultEQ-X. This is the file the download edits.</p>
        <div id="dropzone" class="dropzone">
          <p>Drop a .ady file here, or</p>
          <label class="file-pick">
            <input type="file" id="file-input" accept=".ady" class="visually-hidden" />
            <span class="button">Choose .ady…</span>
            <span class="file-name" data-for="file-input">No file chosen</span>
          </label>
        </div>
        <p id="error-message" class="error" hidden></p>
      </section>

      <p id="editor-placeholder" class="placeholder">2 · Design the curve: load a .ady first.</p>
      <section id="editor" class="step" hidden>
        <h2 class="step-title"><span class="step-num">2</span> Design the curve</h2>
        <div class="workbench">
          <div class="workbench-left">
            <div class="card chart-card">
              <div id="chart"></div>
              <p class="hint">Drag a shelf or bell handle to move it; scroll over a handle to change its Q.</p>
            </div>
            <div class="card">
              <h3 class="card-title">Compare</h3>
              <p class="hint">
                Save the current design into a slot to see it drawn faintly while you keep editing. Load a slot to
                make it the design you edit and download.
              </p>
              <div id="slot-list"></div>
            </div>
          </div>
          <div class="workbench-right">
            <div class="card">
              <h3 class="card-title">Audyssey behaviour</h3>
              <label class="field">
                HF rolloff type
                <select id="rolloff-type">
                  <option value="1">High Frequency Roll Off 1</option>
                  <option value="2">High Frequency Roll Off 2</option>
                </select>
              </label>
              <p id="rolloff-notice" class="warning" hidden></p>
              <label class="check"><input type="checkbox" id="cancel-rolloff" checked /> Cancel Audyssey's HF rolloff</label>
              <p class="hint">Untick to see the rolloff on the curve, as the AVR applies it.</p>
              <label class="check"><input type="checkbox" id="sub-trim" checked /> Compensate sub trim</label>
              <p id="sub-trim-notice" class="warning" hidden></p>
              <p id="sub-trim-peak" class="hint" hidden></p>
            </div>
            <div class="card">
              <h3 class="card-title">Curve bands</h3>
              <div class="toolbar">
                <label class="field">
                  Preset
                  <select id="preset-select">
                    <option value="">Load preset…</option>
                  </select>
                </label>
                <div class="toolbar-group">
                  <label class="field">
                    Add band
                    <select id="add-band-type"></select>
                  </label>
                  <button type="button" id="add-band" class="ghost">Add</button>
                </div>
              </div>
              <p id="preset-description" class="hint"></p>
              <div id="band-list"></div>
              <p id="band-error" class="error" hidden></p>
              <p id="band-level" class="hint"></p>
            </div>
            <div class="card">
              <h3 class="card-title">Save or load a design</h3>
              <div class="toolbar">
                <label class="field">
                  Design name
                  <input type="text" id="design-name" placeholder="e.g. My target" maxlength="60" />
                </label>
                <button type="button" id="design-save">Save design</button>
                <label class="file-pick">
                  <input type="file" id="design-load" accept=".json,application/json" class="visually-hidden" />
                  <span class="button ghost">Load design…</span>
                </label>
              </div>
              <p id="design-file-error" class="error" hidden></p>
            </div>
          </div>
        </div>
      </section>

      <p id="download-placeholder" class="placeholder">3 · Download: available once a .ady is loaded.</p>
      <section id="download-section" class="card step" hidden>
        <h2 class="step-title"><span class="step-num">3</span> Download</h2>
        <ul id="download-summary" class="checklist"></ul>
        <p id="no-subwoofer-warning" class="warning" hidden>
          No subwoofer channel detected, so there is no sub trim to compensate.
        </p>
        <button type="button" id="download">Download .ady</button>
      </section>
    </div>
    <script type="module" src="/src/design/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: The stylesheet**

Replace the whole of `src/style.css` with:

```css
:root {
  color-scheme: dark;
  --bg: #121318;
  --surface: #1b1d24;
  --surface-raised: #22252f;
  --field: #262a35;
  --border: #2f333f;
  --text: #e8e9ee;
  --text-muted: #9aa0ad;
  --accent: #5b6cff;
  --accent-soft: #323752;
  --accent-text: #aab2ff;
  --danger: #ff6b6b;
  --warning: #f5c26b;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.45;
}

a {
  color: var(--accent-text);
}

p {
  margin: 0.4rem 0;
}

/* page frame */

.page {
  max-width: 1240px;
  margin: 0 auto;
  padding: 1.25rem 16px 3rem;
}

.site-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1.5rem;
  margin-bottom: 1.25rem;
}

.site-header h1 {
  margin: 0;
  font-size: 1.35rem;
}

.site-header h1 a {
  color: inherit;
  text-decoration: none;
}

.site-header nav {
  color: var(--text-muted);
  font-size: 0.95rem;
}

.nav-current {
  color: var(--text);
  font-weight: 600;
}

/* cards and steps */

.card {
  background: linear-gradient(180deg, var(--surface-raised), var(--surface));
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}

.card-title {
  margin: 0 0 0.6rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent-text);
}

.step {
  margin-top: 1.5rem;
}

.step-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0 0 0.6rem;
  font-size: 1.15rem;
}

.step-num {
  display: inline-grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 0.95rem;
}

.placeholder {
  margin: 0 0 1rem;
  padding: 0.75rem 1.25rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
}

.hint {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.error {
  color: var(--danger);
  font-weight: 600;
}

.warning {
  color: var(--warning);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* controls */

button,
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  padding: 0.45rem 1rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

button.ghost,
.button.ghost {
  background: var(--field);
  border-color: var(--border);
  color: var(--text);
  font-weight: 500;
}

button.small,
.button.small {
  font-size: 0.85rem;
  padding: 0.25rem 0.7rem;
}

button:hover:not(:disabled),
.file-pick:hover .button {
  filter: brightness(1.12);
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

input[type='text'],
input[type='number'],
select {
  min-width: 0;
  font: inherit;
  font-size: 0.9rem;
  color: var(--text);
  background: var(--field);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.55rem;
}

input[type='checkbox'] {
  width: 1rem;
  height: 1rem;
  margin: 0;
  accent-color: var(--accent);
}

input[type='number']:invalid {
  outline: 2px solid var(--danger);
}

:focus-visible,
.file-pick:focus-within .button {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.6rem 0 0.1rem;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem 1rem;
}

.toolbar-group {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.file-pick {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
}

.file-name {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem 1rem;
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  text-align: center;
}

.dropzone.dragover {
  border-color: var(--accent);
  background: rgba(91, 108, 255, 0.08);
}

/* workbench: chart and compare on the left (sticky), tools on the right */

.workbench {
  display: grid;
  gap: 1rem;
  align-items: start;
}

.chart-card {
  padding: 0.75rem;
}

@media (min-width: 960px) {
  .workbench {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  }

  .workbench-left {
    position: sticky;
    top: 1rem;
  }
}

@media (max-width: 959.98px) {
  .workbench {
    gap: 0;
  }

  /* the chart card becomes a direct grid item, so it can stick above the tools */
  .workbench-left {
    display: contents;
  }

  .chart-card {
    position: sticky;
    top: 0;
    z-index: 5;
  }
}

/* chart legend: names always, values only while the pointer is on the chart */

.u-legend {
  color: var(--text);
  font-size: 0.8rem;
}

.u-legend .u-series {
  pointer-events: none;
}

.u-legend .u-series.u-off {
  display: none;
}

.u-legend .u-value,
.u-legend .u-series:first-child {
  visibility: hidden;
}

.uplot:hover .u-legend .u-value,
.uplot:hover .u-legend .u-series:first-child {
  visibility: visible;
}

/* chart handles */

.handle-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.band-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #e33;
  box-shadow: 0 0 0 1px #000;
  cursor: grab;
  pointer-events: auto;
  touch-action: none;
}

.band-handle:hover,
.band-handle.dragging {
  background: #fff;
  border-color: #e33;
}

.band-handle.dragging {
  cursor: grabbing;
}

/* bands */

.band {
  margin: 0.6rem 0;
  padding: 0.6rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.band-off {
  opacity: 0.5;
}

.band-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
}

.band-header button {
  margin-left: auto;
}

.badge {
  display: inline-block;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 0.75rem;
  font-weight: 600;
}

.band-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
}

.band-fields input {
  width: 6.5rem;
}

#design-name {
  width: 13rem;
}

/* compare slots */

.slot {
  display: grid;
  grid-template-columns: 1.5rem 1rem 5rem repeat(3, auto);
  justify-content: start;
  align-items: center;
  gap: 0.5rem;
  margin: 0.35rem 0;
}

.slot-swatch {
  width: 1.5rem;
  height: 0.3rem;
  border-radius: 2px;
}

.slot-status {
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* download checklist */

.checklist {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
}

.checklist li {
  padding: 0.15rem 0;
}

.checklist li::before {
  content: '✓';
  display: inline-block;
  width: 1.4rem;
  color: var(--accent-text);
  font-weight: 700;
}

.checklist li.off::before {
  content: '—';
  color: var(--text-muted);
}

/* tables */

table {
  width: 100%;
  margin: 0.5rem 0;
  border-collapse: collapse;
  font-size: 0.9rem;
}

th,
td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

th {
  color: var(--text-muted);
  font-weight: 600;
}

/* correct page: one row per speaker */

.gen-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border);
}

.gen-row:last-child {
  border-bottom: none;
}

.channel-name {
  min-width: 3.5rem;
  font-weight: 700;
}

/* start page */

.choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.choice {
  display: block;
  color: inherit;
  text-decoration: none;
}

.choice:hover {
  border-color: var(--accent);
}

.choice h2 {
  margin: 0 0 0.4rem;
  font-size: 1.15rem;
  color: var(--accent-text);
}
```

- [ ] **Step 7: File-picker helper**

Create `src/ui/filePick.ts`:

```ts
/** Shows `name` in the `.file-name` label tied to input `#inputId` (for files that arrive by drag and drop). */
export function showFileName(inputId: string, name: string): void {
  const label = document.querySelector<HTMLElement>(`.file-name[data-for="${inputId}"]`);
  if (label) label.textContent = name;
}

/** Keeps every `.file-name[data-for]` label showing the file chosen in its input. */
export function bindFileNames(): void {
  document.querySelectorAll<HTMLElement>('.file-name[data-for]').forEach((label) => {
    const input = document.getElementById(label.dataset.for as string) as HTMLInputElement | null;
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) label.textContent = file.name;
    });
  });
}
```

- [ ] **Step 8: Chart: shared options, resize, no title**

In `src/chart.ts`:
- Add after the imports:

```ts
/** Wide screens show the chart beside the tools; narrow ones stick a short chart above them. */
const WIDE_LAYOUT = '(min-width: 960px)';

function chartHeight(): number {
  return window.matchMedia(WIDE_LAYOUT).matches ? 420 : 220;
}

/** Scales, axes and cursor shared by every chart in the tool. */
export function baseChartOptions(): Pick<uPlot.Options, 'scales' | 'axes' | 'cursor'> {
  return {
    // the axes are fixed and the handles use the mouse, so a drag must not zoom
    cursor: { drag: { x: false, y: false } },
    scales: {
      x: { time: false, distr: 3, range: [20, 20000] },
      y: { range: [-15, 15] },
    },
    axes: [
      { label: 'Frequency (Hz)', stroke: '#ccc', grid: { stroke: '#333' } },
      { label: 'Gain (dB)', stroke: '#ccc', grid: { stroke: '#333' } },
    ],
  };
}

/** Keeps `chart` as wide as `container` and as tall as the current layout wants. */
export function fitChart(chart: uPlot, container: HTMLElement): void {
  const fit = () => {
    const width = container.clientWidth;
    const height = chartHeight();
    if (width > 0 && (width !== chart.width || height !== chart.height)) chart.setSize({ width, height });
  };
  new ResizeObserver(fit).observe(container);
  window.matchMedia(WIDE_LAYOUT).addEventListener('change', fit);
}
```

- In `createChart`, replace the `opts` object's lines from `title: 'Target Curve',` through the closing `],` of `axes` with:

```ts
    ...baseChartOptions(),
    width: container.clientWidth || 800,
    height: chartHeight(),
```

- Replace the last two lines of `createChart` (`const chart = new uPlot(...)` and `return chart;`) with:

```ts
  const chart = new uPlot(opts, chartData(params, []), container);
  fitChart(chart, container);
  return chart;
```

- [ ] **Step 9: Band rows and slot rows**

In `src/bandsUi.ts`, inside `renderRow`:
- Replace the `title` lines (`const title = …` to `header.appendChild(title);`) with:

```ts
    const title = document.createElement('strong');
    title.textContent = `Band ${index + 1}`;
    header.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = BAND_LABELS[band.type];
    header.appendChild(badge);
```

- After `remove.type = 'button';` add `remove.className = 'small ghost';`.
- After `const label = document.createElement('label');` add `label.className = 'field';`.

In `src/designUi.ts`:
- Replace the `button` helper with:

```ts
  function button(
    text: string,
    title: string,
    onClick: () => void,
    className: string,
    disabled = false
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.className = className;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }
```

- In `renderSlot`, replace everything from `row.appendChild(\n      button('Save here'` to the end of the `if (saved !== null) { … }` block with:

```ts
    row.append(
      button(
        'Save here',
        `Store the current design in slot ${id} and draw it faintly on the chart`,
        () => {
          const problem = validateBands(host.params.bands);
          if (problem !== null) {
            showError(`Fix the band values before saving to a slot. ${problem}`);
            return;
          }
          showError(null);
          host.slots.save(id, host.params.bands);
          refreshSlots();
          host.onSlotsChanged();
        },
        'small'
      ),
      button(
        'Load',
        `Make slot ${id} the design you are editing (replaces the current bands)`,
        () => host.replaceDesign(host.slots.get(id) ?? [], undefined, `Loaded slot ${id}.`),
        'small ghost',
        saved === null
      ),
      button(
        'Clear',
        `Empty slot ${id}`,
        () => {
          host.slots.clear(id);
          refreshSlots();
          host.onSlotsChanged();
        },
        'small ghost',
        saved === null
      )
    );
```

- [ ] **Step 10: Move the entry script**

`git mv src/main.ts src/design/main.ts`, then in `src/design/main.ts`:
- Change every import path `'./x'` to `'../x'` (e.g. `'./ady'` → `'../ady'`, `'./ui/checklist'` → `'../ui/checklist'`), and add `import { bindFileNames, showFileName } from '../ui/filePick';`.
- In `applyFileDefaults`, replace the `if (processed) { … }` block with:

```ts
  if (processed) {
    const link = document.createElement('a');
    link.href = './correct.html';
    link.textContent = 'Correct page';
    subTrimNotice.replaceChildren(
      'This file already has a target curve written by this tool, so its sub trim was probably already compensated. Sub trim compensation is off; tick it if you know it is not. To add a measured correction to this file, use the ',
      link,
      ' instead.'
    );
  }
```

- In `loadFile`, add `showFileName('file-input', file.name);` as its first line.
- Replace the two dropzone listeners with:

```ts
dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});
```

- Add `bindFileNames();` on the line before the final `onParamsChanged();`.

- [ ] **Step 11: Verify**

Run: `npx tsc --noEmit -p . && npx vitest run && npm run build`
Expected: tsc clean; all tests pass including `scripts/page-ids.test.ts`; the build writes `dist/index.html` and `dist/design.html`.

Run `npx vite preview --port 5199 --strictPort` in the background and fetch `http://localhost:5199/design.html` with curl to confirm it is served (status 200); stop the preview afterwards. (The visual check is done by the controller in the browser.)

- [ ] **Step 12: Commit**

```bash
git add -A index.html design.html vite.config.ts src scripts/page-ids.test.ts
git commit -m "feat: start page and the design page workbench layout with the card style

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Correct page

**Files:**
- Create: `correct.html`, `src/correct/main.ts`, `src/correct/previewChart.ts`
- Modify: `vite.config.ts`, `scripts/page-ids.test.ts`

**Interfaces:**
- Consumes: `parseAdy`, `isSubwooferChannel`, `serializeAdy`, `applyMeasuredCorrection`, `AdyValidationError` (ady.ts); `checkMeasuredType`, `measureCorrection`, `MeasuredResult`, `SpeakerInput` (generate.ts); `DEFAULT_CUTOFF_HZ`, `MIN_CUTOFF_HZ`, `MAX_CUTOFF_HZ`, `buildChannelTrims`, `summarizeCorrection` (correction.ts); `previewCurves`, `PreviewCurves` (correctionPreview.ts); `correctChecklist`, `measuredFilename` (downloadSummary.ts); `renderChecklist`; `bindFileNames`, `showFileName`; `baseChartOptions`, `fitChart` (chart.ts).

- [ ] **Step 1: Add the page to the id test and see it fail**

In `scripts/page-ids.test.ts`, add to `PAGES`:

```ts
  'correct.html': ['src/correct/main.ts'],
```

Run: `npx vitest run scripts/page-ids.test.ts`
Expected: FAIL (`correct.html` does not exist).

- [ ] **Step 2: The Correct page HTML**

Create `correct.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Apply a Measured Correction · Audyssey Target Curve Editor</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div class="page">
      <header class="site-header">
        <h1><a href="./index.html">Audyssey Target Curve Editor</a></h1>
        <nav><a href="./design.html">Design a curve</a> · <span class="nav-current">Apply a measured correction</span></nav>
      </header>

      <section class="card">
        <h2 class="step-title"><span class="step-num">1</span> Load your .ady</h2>
        <p class="hint">
          The .ady this tool made, as loaded on the AVR when you took the REW sweeps. Its curves are what the
          measurements are compared with, and it is the file the download edits.
        </p>
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
      </section>

      <p id="measure-placeholder" class="placeholder">2 · Add measurements: load a .ady first.</p>
      <section id="measure-step" class="step" hidden>
        <h2 class="step-title"><span class="step-num">2</span> Add measurements</h2>
        <div class="workbench">
          <div class="workbench-left">
            <div class="card chart-card">
              <label class="field">
                Channel
                <select id="preview-channel" disabled></select>
              </label>
              <div id="preview-chart"></div>
              <p id="preview-hint" class="hint">Pick REW files for a speaker to see its correction.</p>
            </div>
          </div>
          <div class="workbench-right">
            <div class="card">
              <h3 class="card-title">REW measurements</h3>
              <p class="hint">
                Text exports from REW, about 3 positions per speaker is plenty. Speakers without files are left
                unchanged.
              </p>
              <div id="speaker-rows"></div>
              <p id="measure-error" class="error" hidden></p>
            </div>
            <div class="card">
              <h3 class="card-title">Correction</h3>
              <label class="field">
                Cutoff (Hz)
                <input type="number" id="cutoff" step="50" />
              </label>
              <p class="hint">
                No correction below the cutoff; it fades in over an octave around it. Each curve keeps its level at
                1 kHz.
              </p>
              <table id="correction-table" hidden>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Positions</th>
                    <th>Error RMS 2–20 kHz (dB)</th>
                    <th>Largest trim (dB)</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
              <p id="measure-warnings" class="warning" hidden></p>
            </div>
          </div>
        </div>
      </section>

      <p id="download-placeholder" class="placeholder">3 · Download: available once measurements are added.</p>
      <section id="download-section" class="card step" hidden>
        <h2 class="step-title"><span class="step-num">3</span> Download</h2>
        <ul id="download-summary" class="checklist"></ul>
        <button type="button" id="download">Download .ady</button>
      </section>
    </div>
    <script type="module" src="/src/correct/main.ts"></script>
  </body>
</html>
```

In `vite.config.ts`, add `correct: page('./correct.html'),` to `input`.

- [ ] **Step 3: The preview chart**

Create `src/correct/previewChart.ts`:

```ts
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { baseChartOptions, fitChart } from '../chart';
import type { PreviewCurves } from '../correctionPreview';
import { logGrid } from '../measuredError';

function emptyData(): uPlot.AlignedData {
  const freq = logGrid();
  const empty = freq.map(() => null);
  return [freq, empty, empty, empty] as unknown as uPlot.AlignedData;
}

/** The Correct page chart: the current target, the measurement and the corrected target for one channel. */
export function createPreviewChart(container: HTMLElement): uPlot {
  const opts: uPlot.Options = {
    ...baseChartOptions(),
    width: container.clientWidth || 800,
    height: 420,
    series: [
      {},
      { label: 'Current target', stroke: '#9aa0ad', width: 1.5 },
      { label: 'Measured', stroke: 'rgba(245, 194, 107, 0.9)', width: 1 },
      { label: 'Corrected target', stroke: '#5b6cff', width: 2 },
    ],
  };
  const chart = new uPlot(opts, emptyData(), container);
  fitChart(chart, container);
  return chart;
}

export function updatePreviewChart(chart: uPlot, curves: PreviewCurves | null): void {
  chart.setData(
    curves
      ? ([curves.freq, curves.current, curves.measured, curves.corrected] as unknown as uPlot.AlignedData)
      : emptyData()
  );
}
```

- [ ] **Step 4: The Correct page script**

Create `src/correct/main.ts`:

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
  summarizeCorrection,
} from '../correction';
import { previewCurves } from '../correctionPreview';
import { correctChecklist, measuredFilename } from '../downloadSummary';
import { checkMeasuredType, measureCorrection, type MeasuredResult, type SpeakerInput } from '../generate';
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
const measurePlaceholder = el<HTMLElement>('measure-placeholder');
const measureStep = el<HTMLElement>('measure-step');
const speakerRows = el<HTMLElement>('speaker-rows');
const measureError = el<HTMLElement>('measure-error');
const cutoffInput = el<HTMLInputElement>('cutoff');
const correctionTable = el<HTMLElement>('correction-table');
const correctionBody = correctionTable.querySelector('tbody') as HTMLElement;
const measureWarnings = el<HTMLElement>('measure-warnings');
const previewChannel = el<HTMLSelectElement>('preview-channel');
const previewContainer = el<HTMLElement>('preview-chart');
const previewHint = el<HTMLElement>('preview-hint');
const downloadPlaceholder = el<HTMLElement>('download-placeholder');
const downloadSection = el<HTMLElement>('download-section');
const downloadSummary = el<HTMLElement>('download-summary');
const downloadButton = el<HTMLButtonElement>('download');

let ady: AdyFile | null = null;
let rolloffType: RolloffType = 2;
let result: MeasuredResult | null = null;
let cutoffHz = DEFAULT_CUTOFF_HZ;
let chart: ReturnType<typeof createPreviewChart> | null = null;
/** Bumped on every change of inputs, so a slow file read can't overwrite a newer result. */
let generation = 0;

cutoffInput.min = String(MIN_CUTOFF_HZ);
cutoffInput.max = String(MAX_CUTOFF_HZ);
cutoffInput.value = String(DEFAULT_CUTOFF_HZ);

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

async function loadFile(file: File): Promise<void> {
  showFileName('file-input', file.name);
  generation++;
  result = null;
  try {
    const parsed = parseAdy(await file.text());
    rolloffType = checkMeasuredType(parsed);
    const speakers = parsed.detectedChannels.filter((c) => !isSubwooferChannel(c));
    if (!speakers.some((c) => c.customTargetCurvePoints.length > 0)) {
      throw new Error('This file has no target curves. Design one on the Design page first.');
    }
    ady = parsed;
    show(errorMessage, null);
    show(fileInfo, `${speakers.length} speakers · High Frequency Roll Off ${rolloffType}`);
  } catch (err) {
    ady = null;
    show(fileInfo, null);
    show(
      errorMessage,
      err instanceof AdyValidationError ? `Not a valid .ady file: ${err.message}` : (err as Error).message
    );
  }
  show(measureError, null);
  buildRows();
  render();
}

/** One row per speaker with a multi-file input for its REW exports. */
function buildRows(): void {
  speakerRows.replaceChildren();
  if (!ady) return;
  for (const channel of ady.detectedChannels) {
    if (isSubwooferChannel(channel)) continue;
    const row = document.createElement('div');
    row.className = 'gen-row';
    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = channel.commandId;
    row.appendChild(name);

    if (channel.customTargetCurvePoints.length === 0) {
      const note = document.createElement('span');
      note.className = 'hint';
      note.textContent = 'No target curve in this file, so it is left unchanged.';
      row.appendChild(note);
    } else {
      const pick = document.createElement('label');
      pick.className = 'file-pick';
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.txt,.csv,.tsv,text/plain,text/csv';
      input.className = 'visually-hidden';
      input.dataset.channel = channel.commandId;
      const choose = document.createElement('span');
      choose.className = 'button ghost small';
      choose.textContent = 'Choose files…';
      const chosen = document.createElement('span');
      chosen.className = 'file-name';
      chosen.textContent = 'No files';
      input.addEventListener('change', () => {
        const files = Array.from(input.files ?? []);
        chosen.textContent =
          files.length === 0 ? 'No files' : files.length === 1 ? files[0].name : `${files.length} files`;
        void recompute();
      });
      pick.append(input, choose, chosen);
      row.appendChild(pick);
    }
    speakerRows.appendChild(row);
  }
}

/** Reads every chosen REW file and measures the correction. */
async function recompute(): Promise<void> {
  const current = ady;
  if (!current) return;
  const mine = ++generation;
  const speakers: SpeakerInput[] = [];
  for (const input of speakerRows.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    const files = Array.from(input.files ?? []);
    if (files.length === 0) continue;
    speakers.push({
      commandId: input.dataset.channel as string,
      files: await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))),
    });
  }
  if (mine !== generation) return;
  if (speakers.length === 0) {
    result = null;
    show(measureError, null);
  } else {
    try {
      result = measureCorrection(current, speakers);
      show(measureError, null);
    } catch (err) {
      result = null;
      show(measureError, (err as Error).message);
    }
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
  const trims = summarizeCorrection(result.correction, cutoffHz);
  for (const report of result.reports) {
    const largest = trims.find((t) => t.commandId === report.commandId)?.maxAbsTrim ?? 0;
    const tr = document.createElement('tr');
    tr.append(
      cell(report.commandId),
      cell(String(report.positions)),
      cell(report.rmsError.toFixed(2)),
      cell(largest.toFixed(2))
    );
    correctionBody.appendChild(tr);
  }
  correctionTable.hidden = false;
  show(measureWarnings, result.warnings.length > 0 ? result.warnings.join(' ') : null);
}

function renderPreview(): void {
  if (!ady) return;
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
  const channel = keep ? ady.detectedChannels.find((c) => c.commandId === keep) : undefined;
  if (!result || !keep || !channel) {
    updatePreviewChart(chart, null);
    return;
  }
  previewChannel.value = keep;
  updatePreviewChart(chart, previewCurves(channel, rolloffType, result.correction[keep], cutoffHz));
}

function render(): void {
  measureStep.hidden = ady === null;
  measurePlaceholder.hidden = ady !== null;
  const ready = ady !== null && result !== null;
  downloadSection.hidden = !ready;
  downloadPlaceholder.hidden = ready;
  renderTable();
  renderPreview();
  if (result) renderChecklist(downloadSummary, correctChecklist(Object.keys(result.correction), cutoffHz));
}

function cutoffValid(): boolean {
  const value = Number(cutoffInput.value);
  return (
    cutoffInput.value.trim() !== '' && Number.isFinite(value) && value >= MIN_CUTOFF_HZ && value <= MAX_CUTOFF_HZ
  );
}

cutoffInput.addEventListener('input', () => {
  if (!cutoffValid()) return;
  cutoffHz = Number(cutoffInput.value);
  render();
});

// a cleared or out-of-range field snaps back to the value in use
cutoffInput.addEventListener('change', () => {
  if (!cutoffValid()) cutoffInput.value = String(cutoffHz);
});

previewChannel.addEventListener('change', () => renderPreview());

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
});

downloadButton.addEventListener('click', () => {
  if (!ady || !result) return;
  const corrected = applyMeasuredCorrection(ady, buildChannelTrims(result.correction, cutoffHz));
  const url = URL.createObjectURL(new Blob([serializeAdy(corrected)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = measuredFilename(ady.title, cutoffHz);
  a.click();
  URL.revokeObjectURL(url);
});

bindFileNames();
render();
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit -p . && npx vitest run && npm run build`
Expected: tsc clean; all tests pass (page-id test covers both pages); `dist/` contains `index.html`, `design.html`, `correct.html`.

```bash
git add -A correct.html vite.config.ts src scripts/page-ids.test.ts
git commit -m "feat: add the correct page (measured correction on the file's own curve)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-27-two-workflows-design.md`

- [ ] **Step 1: README**

Replace the "What it does" section of `README.md` (from `## What it does` up to, not including, `Design files are`) with:

```markdown
## What it does

The start page offers two jobs:

1. **Design a target curve.** Load the raw `.ady` from MultEQ-X and design the
   curve as a sum of bands (tilt, low/high shelf, bell). Start from a preset,
   edit bands, or drag a shelf/bell handle on the chart (scroll over a handle to
   change its Q). Choose Audyssey's HF rolloff type (read from the file), whether
   to cancel it, and whether to compensate the sub trim. Save the design into
   compare slot A, B or C to see it drawn faintly while you keep editing, or save
   it as a small JSON file. Download the `.ady`.
2. **Apply a measured correction.** Load a `.ady` this tool made, the one that
   was on the AVR when you took REW measurements, and add the REW exports per
   speaker. The page shows each speaker's current target, measurement and
   corrected target, and downloads the file with the correction added on top of
   its own curves (lined up and pinned at 1 kHz, nothing below the cutoff,
   sub trim and channel levels untouched). Load the result on the AVR, measure
   again and repeat to refine.
```

- [ ] **Step 2: Spec refinement note**

Append to `docs/superpowers/specs/2026-09-27-two-workflows-design.md`:

```markdown

## As built

- The Design page puts "Save or load a design" in its own card below the bands
  card, rather than inside the presets card.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-27-two-workflows-design.md
git commit -m "docs: describe the two workflows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

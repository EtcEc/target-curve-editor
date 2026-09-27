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
  DEFAULT_TRIM_OPTIONS,
  DETAIL_STEPS,
  MAX_LIMIT_DB,
  MIN_LIMIT_DB,
  formatOctaves,
  type TrimOptions,
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

let ady: AdyFile | null = null;
let rolloffType: RolloffType = 2;
let result: MeasuredResult | null = null;
let cutoffHz = DEFAULT_CUTOFF_HZ;
let chart: ReturnType<typeof createPreviewChart> | null = null;
/** Bumped on every change of inputs, so a slow file read can't overwrite a newer result. */
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

async function loadFile(file: File): Promise<void> {
  showFileName('file-input', file.name);
  const mine = ++generation;
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    if (mine !== generation) return;
    ady = null;
    result = null;
    show(fileInfo, null);
    show(errorMessage, `Could not read file: ${(err as Error).message}`);
    show(measureError, null);
    buildRows();
    render();
    return;
  }
  if (mine !== generation) return;
  result = null;
  try {
    const parsed = parseAdy(text);
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
  try {
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
      result = measureCorrection(current, speakers);
      show(measureError, null);
    }
  } catch (err) {
    if (mine === generation) {
      result = null;
      show(measureError, (err as Error).message);
    }
  }
  if (mine === generation) {
    render();
  }
}

function renderTable(): void {
  correctionBody.replaceChildren();
  if (!result) {
    correctionTable.hidden = true;
    show(measureWarnings, null);
    return;
  }
  const trims = summarizeCorrection(result.correction, cutoffHz, trimOptions);
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
  updatePreviewChart(chart, previewCurves(channel, rolloffType, result.correction[keep], cutoffHz, trimOptions));
}

function render(): void {
  measureStep.hidden = ady === null;
  measurePlaceholder.hidden = ady !== null;
  const ready = ady !== null && result !== null;
  downloadSection.hidden = !ready;
  downloadPlaceholder.hidden = ready;
  renderTable();
  renderPreview();
  if (result) renderChecklist(downloadSummary, correctChecklist(Object.keys(result.correction), cutoffHz, trimOptions));
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
  const corrected = applyMeasuredCorrection(ady, buildChannelTrims(result.correction, cutoffHz, trimOptions));
  const url = URL.createObjectURL(new Blob([serializeAdy(corrected)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = measuredFilename(ady.title, cutoffHz);
  a.click();
  URL.revokeObjectURL(url);
});

readSettings();
bindFileNames();
render();

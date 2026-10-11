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

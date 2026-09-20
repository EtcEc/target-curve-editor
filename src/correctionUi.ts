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
  /** The current (valid) cutoff in Hz. */
  getCutoffHz(): number;
}

const MIN_CUTOFF_HZ = 200;
const MAX_CUTOFF_HZ = 18000;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

function query<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`Missing element ${selector}`);
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
  const summaryBody = query<HTMLElement>('#correction-summary tbody');
  const notice = el<HTMLElement>('correction-notice');

  // generate elements
  const measuredInput = el<HTMLInputElement>('measured-ady-input');
  const generateError = el<HTMLElement>('generate-error');
  const rows = el<HTMLElement>('generate-rows');
  const labelInput = el<HTMLInputElement>('generate-label');
  const generateButton = el<HTMLButtonElement>('generate-button');
  const generateWarnings = el<HTMLElement>('generate-warnings');
  const reportTable = el<HTMLElement>('generate-report');
  const reportBody = query<HTMLElement>('#generate-report tbody');

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
    info.textContent = `Correction loaded: ${correction.label || 'unlabelled'} (created ${correction.created})`;
    summaryBody.innerHTML = '';
    const summary = summarizeCorrection(correction, cutoffHz, baseChannelIds);
    for (const row of summary) {
      const tr = document.createElement('tr');
      tr.append(cell(row.commandId), cell(String(row.positions)), cell(row.maxAbsTrim.toFixed(2)));
      summaryBody.appendChild(tr);
    }
    const ignored = summary.filter((r) => !r.inBase).map((r) => r.commandId);
    // with no base .ady loaded yet, "ignored" would be meaningless
    show(notice, baseChannelIds.length > 0 && ignored.length > 0 ? `Not in the loaded .ady, so ignored: ${ignored.join(', ')}.` : null);
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

  function clearReport(): void {
    reportBody.innerHTML = '';
    reportTable.hidden = true;
    show(generateWarnings, null);
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      correction = parseCorrection(await file.text());
      show(errorNode, null);
      clearReport();
    } catch (err) {
      correction = null;
      show(errorNode, (err as Error).message);
    }
    renderApply();
    onChange();
  });

  enabled.addEventListener('change', () => onChange());

  function cutoffValid(): boolean {
    const value = Number(cutoffInput.value);
    return cutoffInput.value.trim() !== '' && Number.isFinite(value) && value >= MIN_CUTOFF_HZ && value <= MAX_CUTOFF_HZ;
  }

  function markCutoff(): void {
    const ok = cutoffValid();
    cutoffInput.setCustomValidity(ok ? '' : `Enter ${MIN_CUTOFF_HZ} to ${MAX_CUTOFF_HZ} Hz.`);
    cutoffInput.title = ok ? '' : `Enter ${MIN_CUTOFF_HZ} to ${MAX_CUTOFF_HZ} Hz.`;
  }

  cutoffInput.addEventListener('input', () => {
    markCutoff();
    if (cutoffValid()) {
      cutoffHz = Number(cutoffInput.value);
      renderApply();
      onChange();
    }
  });

  cutoffInput.addEventListener('change', () => {
    if (!cutoffValid()) cutoffInput.value = String(cutoffHz);
    markCutoff();
  });

  measuredInput.addEventListener('change', async () => {
    const file = measuredInput.files?.[0];
    measuredAdy = null;
    rows.innerHTML = '';
    clearReport();
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
      show(errorNode, null);
      renderReport(result);
      renderApply();
      onChange();
    } catch (err) {
      show(generateError, (err as Error).message);
      clearReport();
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
    getCutoffHz(): number {
      return cutoffHz;
    },
  };
}

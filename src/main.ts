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
import { buildDownloadSummary, buildFilenameSuffix } from './downloadSummary';
import { computeTrimShift, type CurveParams } from './curve';
import { DEFAULT_PRESET_NAME, presetBands } from './presets';

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
const cancelHfKneeInput = document.getElementById('cancel-hf-knee') as HTMLInputElement;
const channelSummaryBody = document.querySelector('#channel-summary tbody') as HTMLElement;
const noSubwooferWarning = document.getElementById('no-subwoofer-warning') as HTMLElement;
const downloadSection = document.getElementById('download-section') as HTMLElement;
const downloadSummary = document.getElementById('download-summary') as HTMLElement;
const editorPlaceholder = document.getElementById('editor-placeholder') as HTMLElement;
const downloadPlaceholder = document.getElementById('download-placeholder') as HTMLElement;
const downloadButton = document.getElementById('download') as HTMLButtonElement;
const correctionUi = initCorrectionUi(() => onParamsChanged());

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

function loadFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    try {
      currentAdy = parseAdy(text);
      correctionUi.setBaseChannels(currentAdy.detectedChannels.map((c) => c.commandId));
      clearError();
      editor.hidden = false;
      downloadSection.hidden = false;
      editorPlaceholder.hidden = true;
      downloadPlaceholder.hidden = true;
      renderChannelSummary();
      renderDownloadSummary();
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
    trimCell.textContent = isSub ? (params.subTrim ? trimShift.toFixed(2) : 'skipped') : '—';
    row.appendChild(trimCell);

    channelSummaryBody.appendChild(row);
  }

  noSubwooferWarning.hidden = anySubwoofer;
}

function renderDownloadSummary(): void {
  if (!currentAdy) return;
  const trims = correctionUi.getTrims();
  const trimmed = currentAdy.detectedChannels
    .filter((c) => !isSubwooferChannel(c) && trims?.has(c.commandId))
    .map((c) => c.commandId);
  downloadSummary.textContent = buildDownloadSummary(params, trimmed, correctionUi.getCutoffHz());
}

function onParamsChanged(): void {
  if (chart) updateChart(chart, params);
  if (currentAdy) {
    renderChannelSummary();
    renderDownloadSummary();
  }
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

cancelHfKneeInput.addEventListener('change', () => {
  params.cancelRolloff = cancelHfKneeInput.checked;
  onParamsChanged();
});

downloadButton.addEventListener('click', () => {
  if (!currentAdy) return;
  const trims = correctionUi.getTrims();
  const result = applyCurveToAdy(currentAdy, params, trims);
  const text = serializeAdy(result);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  // distinct names so test variants can't be mistaken for the normal file
  const suffix = buildFilenameSuffix(params, hasAppliedTrims(currentAdy, trims));
  const filename =
    typeof result.title === 'string' && result.title.length > 0
      ? `${result.title}_corrected${suffix}.ady`
      : `corrected${suffix}.ady`;
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

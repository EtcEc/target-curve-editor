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
  slope: 0.7,
  shelfEnabled: true,
  shelfGain: 4.5,
  cancelHfKnee: true,
};

const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const errorMessage = document.getElementById('error-message') as HTMLElement;
const editor = document.getElementById('editor') as HTMLElement;
const chartContainer = document.getElementById('chart') as HTMLElement;
const slopeRange = document.getElementById('slope') as HTMLInputElement;
const slopeNumber = document.getElementById('slope-number') as HTMLInputElement;
const shelfEnabledInput = document.getElementById('shelf-enabled') as HTMLInputElement;
const cancelHfKneeInput = document.getElementById('cancel-hf-knee') as HTMLInputElement;
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

cancelHfKneeInput.addEventListener('change', () => {
  params.cancelHfKnee = cancelHfKneeInput.checked;
  onParamsChanged();
});

downloadButton.addEventListener('click', () => {
  if (!currentAdy) return;
  const result = applyCurveToAdy(currentAdy, params);
  const text = serializeAdy(result);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  // distinct name so a no-cancel test file can't be mistaken for the normal one
  const suffix = params.cancelHfKnee === false ? '_no-knee-cancel' : '';
  const filename =
    typeof result.title === 'string' && result.title.length > 0
      ? `${result.title}_corrected${suffix}.ady`
      : `corrected${suffix}.ady`;
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

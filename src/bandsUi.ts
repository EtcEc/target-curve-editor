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

  function clearPresetDescription(): void {
    presetDescription.textContent = '';
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
    enabled.setAttribute('aria-label', `Enable band ${index + 1}`);
    enabled.addEventListener('change', () => {
      band.enabled = enabled.checked;
      clearPresetDescription();
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
    remove.setAttribute('aria-label', `Delete band ${index + 1}`);
    remove.addEventListener('click', () => {
      clearPresetDescription();
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
        clearPresetDescription();
        onChange();
      });
      // a cleared/invalid field snaps back to the model's value on blur/commit
      input.addEventListener('change', () => {
        input.value = String((band as unknown as Record<string, number>)[spec.key]);
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
    clearPresetDescription();
    render();
    onChange();
  });

  render();
  return { render };
}

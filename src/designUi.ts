import type { Band } from './bands';
import { validateBands } from './bands';
import type { CurveParams } from './curve';
import { DesignFileError, designFilename, parseDesign, serializeDesign } from './designFile';
import { SLOT_COLORS, SLOT_IDS, type SlotId, type Slots } from './slots';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

export interface DesignUiHost {
  params: CurveParams;
  slots: Slots;
  /**
   * Replaces the design being edited. `cancelRolloff` is only given when a design
   * file carries it. The host re-renders the band rows and refreshes the page.
   */
  replaceDesign(bands: Band[], cancelRolloff: boolean | undefined, note: string): void;
  /** Slot contents changed: redraw the chart. */
  onSlotsChanged(): void;
}

function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Save/load a design as a file, and the three compare slots. */
export function initDesignUi(host: DesignUiHost): { refreshSlots(): void } {
  const nameInput = el<HTMLInputElement>('design-name');
  const saveButton = el<HTMLButtonElement>('design-save');
  const loadInput = el<HTMLInputElement>('design-load');
  const errorNode = el<HTMLElement>('design-file-error');
  const slotList = el<HTMLElement>('slot-list');

  function showError(message: string | null): void {
    errorNode.textContent = message ?? '';
    errorNode.hidden = message === null;
  }

  saveButton.addEventListener('click', () => {
    const problem = validateBands(host.params.bands);
    if (problem !== null) {
      showError(`Fix the band values before saving. ${problem}`);
      return;
    }
    showError(null);
    const name = nameInput.value.trim();
    downloadJson(designFilename(name), serializeDesign(name, host.params.bands, host.params.cancelRolloff));
  });

  loadInput.addEventListener('change', async () => {
    const file = loadInput.files?.[0];
    if (!file) return;
    try {
      const design = parseDesign(await file.text());
      showError(null);
      nameInput.value = design.name;
      host.replaceDesign(
        design.bands,
        design.cancelRolloff,
        design.name ? `Loaded the design "${design.name}" from a file.` : 'Loaded a design from a file.'
      );
    } catch (err) {
      if (err instanceof DesignFileError) showError(`Could not load that design: ${err.message}`);
      else showError(`Could not read that file: ${(err as Error).message}`);
    }
    loadInput.value = ''; // so choosing the same file again still loads it
  });

  function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderSlot(id: SlotId): HTMLElement {
    const saved = host.slots.get(id);
    const row = document.createElement('div');
    row.className = 'slot';
    row.dataset.slot = id;

    const swatch = document.createElement('span');
    swatch.className = 'slot-swatch';
    swatch.style.background = SLOT_COLORS[id];
    const label = document.createElement('strong');
    label.textContent = id;
    const status = document.createElement('span');
    status.className = 'slot-status';
    status.textContent = saved === null ? 'empty' : saved.length === 0 ? 'flat' : `${saved.length} band${saved.length === 1 ? '' : 's'}`;
    row.append(swatch, label, status);

    row.appendChild(
      button('Save here', `Store the current design in slot ${id} and draw it faintly on the chart`, () => {
        if (validateBands(host.params.bands) !== null) return;
        host.slots.save(id, host.params.bands);
        refreshSlots();
        host.onSlotsChanged();
      })
    );
    if (saved !== null) {
      row.appendChild(
        button('Load', `Make slot ${id} the design you are editing (replaces the current bands)`, () => {
          host.replaceDesign(host.slots.get(id) ?? [], undefined, `Loaded slot ${id}.`);
        })
      );
      row.appendChild(
        button('Clear', `Empty slot ${id}`, () => {
          host.slots.clear(id);
          refreshSlots();
          host.onSlotsChanged();
        })
      );
    }
    return row;
  }

  function refreshSlots(): void {
    slotList.replaceChildren(...SLOT_IDS.map(renderSlot));
  }

  refreshSlots();
  return { refreshSlots };
}

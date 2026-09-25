import type { Band } from './bands';

export type SlotId = 'A' | 'B' | 'C';
export const SLOT_IDS: readonly SlotId[] = ['A', 'B', 'C'];

/** Line colour of each slot on the chart (faint), shared with the slot rows. */
export const SLOT_COLORS: Record<SlotId, string> = {
  A: 'rgba(90, 170, 255, 0.7)',
  B: 'rgba(100, 210, 120, 0.7)',
  C: 'rgba(240, 190, 70, 0.7)',
};

export interface Slots {
  /** A copy of the bands saved in the slot, or null when the slot is empty. */
  get(id: SlotId): Band[] | null;
  /** Stores a copy of `bands` (an empty list is a saved flat design). */
  save(id: SlotId, bands: readonly Band[]): void;
  clear(id: SlotId): void;
}

const copy = (bands: readonly Band[]): Band[] => JSON.parse(JSON.stringify(bands)) as Band[];

/** Three compare slots that hold band lists in memory. */
export function createSlots(): Slots {
  const store = new Map<SlotId, Band[]>();
  return {
    get: (id) => {
      const saved = store.get(id);
      return saved ? copy(saved) : null;
    },
    save: (id, bands) => {
      store.set(id, copy(bands));
    },
    clear: (id) => {
      store.delete(id);
    },
  };
}

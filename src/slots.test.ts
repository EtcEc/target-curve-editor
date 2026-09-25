import { describe, expect, it } from 'vitest';
import { SLOT_IDS, createSlots } from './slots';
import { tiltBands } from './fixtures/testParams';

describe('createSlots', () => {
  it('has three empty slots A, B, C', () => {
    const slots = createSlots();
    expect(SLOT_IDS).toEqual(['A', 'B', 'C']);
    for (const id of SLOT_IDS) expect(slots.get(id)).toBeNull();
  });

  it('saves a copy that later edits of the original do not change', () => {
    const slots = createSlots();
    const bands = tiltBands(1);
    slots.save('A', bands);
    if (bands[0].type === 'tilt') bands[0].slope = 5;
    const saved = slots.get('A');
    expect(saved?.[0].type === 'tilt' && saved[0].slope).toBe(1);
  });

  it('hands out copies, so editing what get() returned does not change the slot', () => {
    const slots = createSlots();
    slots.save('B', tiltBands(1));
    const first = slots.get('B');
    if (first && first[0].type === 'tilt') first[0].slope = 9;
    const again = slots.get('B');
    expect(again?.[0].type === 'tilt' && again[0].slope).toBe(1);
  });

  it('saves an empty (flat) design as a filled slot, distinct from an empty slot', () => {
    const slots = createSlots();
    slots.save('C', []);
    expect(slots.get('C')).toEqual([]);
  });

  it('clears a slot', () => {
    const slots = createSlots();
    slots.save('A', tiltBands(1));
    slots.clear('A');
    expect(slots.get('A')).toBeNull();
  });
});

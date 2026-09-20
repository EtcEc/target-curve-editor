import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAdy } from '../src/ady';
import { buildChannelTrims } from '../src/correction';
import { generateCorrection } from '../src/generate';
import { logGrid } from '../src/measuredError';

/**
 * Opt-in check against a real measurement session. Skipped unless REAL_DATA_DIR
 * points at a folder with Default.ady (stock calibration) and L.txt, R.txt, C.txt
 * (REW exports, one per speaker, measured on that stock calibration).
 *
 *   REAL_DATA_DIR=/path/to/folder npx vitest run scripts/acceptance.local.test.ts
 *
 * The bounds are loose on purpose: they encode the shape found in the design
 * spec (a dip near 4 kHz, a lift of ~1-2 dB from 6-10 kHz), not exact numbers.
 */
const dir = process.env.REAL_DATA_DIR;
const SPEAKERS: Record<string, string> = { L: 'FL', R: 'FR', C: 'C' };

function load() {
  const read = (name: string) => readFileSync(join(dir as string, name), 'utf8');
  const ady = parseAdy(read('Default.ady'));
  const speakers = Object.entries(SPEAKERS).map(([file, commandId]) => ({
    commandId,
    files: [{ name: `${file}.txt`, text: read(`${file}.txt`) }],
  }));
  return generateCorrection(ady, speakers, 'acceptance');
}

describe.skipIf(!dir)('local acceptance: real measurement session', () => {
  const grid = logGrid();
  const at = (values: number[], hz: number) => values[grid.findIndex((f) => f >= hz)];
  const meanBetween = (values: number[], lo: number, hi: number) => {
    const picked = values.filter((_, i) => grid[i] >= lo && grid[i] <= hi);
    return picked.reduce((a, b) => a + b, 0) / picked.length;
  };

  it('generates without warnings and with one position per speaker', () => {
    const { correction, warnings } = load();
    expect(warnings).toEqual([]);
    for (const id of Object.values(SPEAKERS)) expect(correction.channels[id].positions).toBe(1);
  });

  it('finds a dip near 4 kHz on every speaker', () => {
    const { correction } = load();
    for (const id of Object.values(SPEAKERS)) {
      const e = at(correction.channels[id].error, 4000);
      expect(e).toBeGreaterThan(-2.2);
      expect(e).toBeLessThan(-0.3);
    }
  });

  it('finds a lift between 6.3 and 10 kHz on every speaker', () => {
    const { correction } = load();
    for (const id of Object.values(SPEAKERS)) {
      const e = meanBetween(correction.channels[id].error, 6300, 10000);
      expect(e).toBeGreaterThan(0.5);
      expect(e).toBeLessThan(2.5);
    }
  });

  it('derives a cut of roughly 0.5-2.5 dB at 10 kHz with the default cutoff', () => {
    const { correction } = load();
    const trims = buildChannelTrims(correction, 2000);
    for (const id of Object.values(SPEAKERS)) {
      const t = trims.get(id)!(10000);
      expect(t).toBeLessThan(-0.5);
      expect(t).toBeGreaterThan(-2.5);
    }
  });
});

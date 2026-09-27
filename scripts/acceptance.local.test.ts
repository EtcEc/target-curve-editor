import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAdy } from '../src/ady';
import { DEFAULT_CUTOFF_HZ, buildChannelTrims } from '../src/correction';
import { measureCorrection } from '../src/generate';
import { logGrid } from '../src/measuredError';

/**
 * Opt-in check against a real measurement session (never committed; needs your own files).
 * Skipped unless both variables are set:
 *
 *   REAL_ADY       the .ady whose filters were loaded on the AVR for the REW sweeps
 *   REAL_DATA_DIR  a folder of REW text exports named "<speaker> Pos<N>.txt"
 *                  (speaker: L, R, C, BL, BR)
 *
 *   REAL_ADY=/path/Tilted.ady REAL_DATA_DIR=/path/folder npx vitest run scripts/acceptance.local.test.ts
 *
 * The checks are deliberately shape-agnostic: they hold for any target curve and
 * either HF rolloff type, and only look for a correction that is sane.
 */
const adyPath = process.env.REAL_ADY;
const dir = process.env.REAL_DATA_DIR;
// BL/BR are assumed to be the surround-back speakers' SLA/SRA channels
const SPEAKERS: Record<string, string> = { L: 'FL', R: 'FR', C: 'C', BL: 'SLA', BR: 'SRA' };

function load() {
  const ady = parseAdy(readFileSync(adyPath as string, 'utf8'));
  const present = readdirSync(dir as string);
  const speakers = Object.entries(SPEAKERS)
    .map(([prefix, commandId]) => ({
      commandId,
      files: present
        .filter((name) => new RegExp(`^${prefix} Pos\\d+\\.txt$`).test(name))
        .map((name) => ({ name, text: readFileSync(join(dir as string, name), 'utf8') })),
    }))
    .filter((s) => s.files.length > 0 && ady.detectedChannels.some((c) => c.commandId === s.commandId));
  return { speakers, result: measureCorrection(ady, speakers) };
}

describe.skipIf(!adyPath || !dir)('local acceptance: real measurement session', () => {
  it('finds speakers and averages every position file it was given', () => {
    const { speakers, result } = load();
    expect(speakers.length).toBeGreaterThan(0);
    for (const s of speakers) expect(result.correction[s.commandId].positions).toBe(s.files.length);
  });

  it('gives no far-off warnings: the target the tool reads back matches what was measured', () => {
    expect(load().result.warnings).toEqual([]);
  });

  it('has a finite error curve on the shared grid for every speaker', () => {
    const { result } = load();
    for (const channel of Object.values(result.correction)) {
      expect(channel.error).toHaveLength(logGrid().length);
      expect(channel.error.every(Number.isFinite)).toBe(true);
    }
  });

  it('keeps every trim within +-3 dB, zero well below the cutoff and pinned at 1 kHz', () => {
    const { result } = load();
    const trims = buildChannelTrims(result.correction, DEFAULT_CUTOFF_HZ);
    for (const trim of trims.values()) {
      for (const f of logGrid()) expect(Math.abs(trim(f))).toBeLessThanOrEqual(3 + 1e-9);
      expect(trim(200)).toBeCloseTo(0, 6);
      expect(Math.abs(trim(1000))).toBeLessThan(0.01);
    }
  });
});

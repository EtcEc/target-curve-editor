import type { RewMeasurement } from '../rewParse';

/** Dense, log-spaced synthetic measurement from 10 Hz to 20 kHz, for tests. */
export function synthMeasurement(fn: (freq: number) => number, points = 3000): RewMeasurement {
  const freq: number[] = [];
  const spl: number[] = [];
  for (let i = 0; i < points; i++) {
    const f = 10 * 2000 ** (i / (points - 1));
    freq.push(f);
    spl.push(fn(f));
  }
  return { freq, spl };
}

/** The same data as REW-style text ("freq, spl[, phase]"), for parser and generate tests. */
export function synthRewText(fn: (freq: number) => number, points = 1500, withPhase = false): string {
  const m = synthMeasurement(fn, points);
  return m.freq
    .map((f, i) => `${f.toFixed(4)}, ${m.spl[i].toFixed(4)}${withPhase ? ', 0.0000' : ''}`)
    .join('\n');
}

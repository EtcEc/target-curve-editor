export interface RewMeasurement {
  freq: number[];
  spl: number[];
}

export class RewParseError extends Error {}

/** A measurement must start at or below this frequency (Hz)... */
const MAX_FIRST_FREQ_HZ = 20.5;
/** ...and end at or above this one. */
const MIN_LAST_FREQ_HZ = 19500;

/**
 * Parses REW "measurement as text" output: frequency and SPL in the first two
 * columns, any further columns (phase) ignored. Lines that don't start with two
 * numbers (comments, headers, blank lines) are skipped, as are non-positive
 * frequencies. `name` is only used in error messages.
 */
export function parseRewText(text: string, name = 'file'): RewMeasurement {
  const freq: number[] = [];
  const spl: number[] = [];

  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/[\s,;]+/);
    if (tokens.length < 2 || tokens[0] === '' || tokens[1] === '') continue;
    const f = Number(tokens[0]);
    const s = Number(tokens[1]);
    if (!Number.isFinite(f) || !Number.isFinite(s) || f <= 0) continue;
    freq.push(f);
    spl.push(s);
  }

  if (freq.length < 2) {
    throw new RewParseError(`${name}: no numeric frequency/SPL data found`);
  }
  for (let i = 1; i < freq.length; i++) {
    if (freq[i] <= freq[i - 1]) {
      throw new RewParseError(`${name}: frequencies are not in ascending order (at ${freq[i]} Hz)`);
    }
  }
  if (freq[0] > MAX_FIRST_FREQ_HZ || freq[freq.length - 1] < MIN_LAST_FREQ_HZ) {
    throw new RewParseError(
      `${name}: measurement must cover 20 Hz to 20 kHz (this one spans ${freq[0]} Hz to ${freq[freq.length - 1]} Hz)`
    );
  }

  return { freq, spl };
}

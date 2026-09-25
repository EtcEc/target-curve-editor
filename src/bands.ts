export interface TiltBand {
  type: 'tilt';
  enabled: boolean;
  /** dB per octave; positive = falling toward the treble. */
  slope: number;
  /** Frequency (Hz) where the tilt is 0 dB. */
  pivot: number;
  /** The tilt holds its value below this frequency (Hz). 20 = no limit. */
  fLow: number;
  /** The tilt holds its value above this frequency (Hz). 20000 = no limit. */
  fHigh: number;
}

export interface ShelfBand {
  type: 'lowShelf' | 'highShelf';
  enabled: boolean;
  /** Full shelf gain in dB. */
  gain: number;
  /** Shelf frequency in Hz (the gain is half its dB value here). */
  freq: number;
  q: number;
}

export interface BellBand {
  type: 'bell';
  enabled: boolean;
  gain: number;
  freq: number;
  q: number;
}

export type Band = TiltBand | ShelfBand | BellBand;
export type BandType = Band['type'];

export const BAND_TYPES: readonly BandType[] = ['tilt', 'lowShelf', 'highShelf', 'bell'];

export const BAND_LABELS: Record<BandType, string> = {
  tilt: 'Tilt',
  lowShelf: 'Low shelf',
  highShelf: 'High shelf',
  bell: 'Bell',
};

/** 10*log10(|N|^2 / |D|^2) for complex N and D given as (re, im). */
function ratioDb(numRe: number, numIm: number, denRe: number, denIm: number): number {
  return 10 * Math.log10((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
}

// The three responses below are the magnitudes (in dB) of the standard analog
// prototypes from the RBJ audio-EQ cookbook, evaluated at s = j*f/f0, with
// A = 10^(gain/40) and r = sqrt(A)/Q.

/** H(s) = A * (s^2 + r*s + A) / (A*s^2 + r*s + 1) */
function lowShelfDb(freq: number, gain: number, f0: number, q: number): number {
  const x = freq / f0;
  const a = 10 ** (gain / 40);
  const r = Math.sqrt(a) / q;
  return gain / 2 + ratioDb(a - x * x, r * x, 1 - a * x * x, r * x);
}

/** H(s) = A * (A*s^2 + r*s + 1) / (s^2 + r*s + A) */
function highShelfDb(freq: number, gain: number, f0: number, q: number): number {
  const x = freq / f0;
  const a = 10 ** (gain / 40);
  const r = Math.sqrt(a) / q;
  return gain / 2 + ratioDb(1 - a * x * x, r * x, a - x * x, r * x);
}

/** H(s) = (s^2 + s*A/Q + 1) / (s^2 + s/(A*Q) + 1) */
function bellDb(freq: number, gain: number, f0: number, q: number): number {
  const x = freq / f0;
  const a = 10 ** (gain / 40);
  return ratioDb(1 - x * x, (a / q) * x, 1 - x * x, x / (a * q));
}

/** Contribution of one band (dB) at `freq` (Hz); 0 when the band is disabled. */
export function bandGain(freq: number, band: Band): number {
  if (!band.enabled) return 0;
  switch (band.type) {
    case 'tilt':
      return band.slope * Math.log2(band.pivot / Math.min(band.fHigh, Math.max(band.fLow, freq)));
    case 'lowShelf':
      return lowShelfDb(freq, band.gain, band.freq, band.q);
    case 'highShelf':
      return highShelfDb(freq, band.gain, band.freq, band.q);
    case 'bell':
      return bellDb(freq, band.gain, band.freq, band.q);
  }
}

/** Plain sum of every enabled band at `freq`. */
export function sumBands(freq: number, bands: readonly Band[]): number {
  let total = 0;
  for (const band of bands) total += bandGain(freq, band);
  return total;
}

/** A message describing the first problem in `bands`, or null when they are all usable. */
export function validateBands(bands: readonly Band[]): string | null {
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const where = `Band ${i + 1} (${BAND_LABELS[band.type]})`;
    const numbers =
      band.type === 'tilt' ? [band.slope, band.pivot, band.fLow, band.fHigh] : [band.gain, band.freq, band.q];
    if (numbers.some((n) => !Number.isFinite(n))) return `${where}: every value must be a number.`;
    if (band.type === 'tilt') {
      if (band.pivot <= 0 || band.fLow <= 0 || band.fHigh <= 0) {
        return `${where}: frequencies must be above 0 Hz.`;
      }
      if (band.fLow >= band.fHigh) return `${where}: "hold below" must be lower than "hold above".`;
    } else {
      if (band.freq <= 0) return `${where}: frequency must be above 0 Hz.`;
      if (band.q <= 0) return `${where}: Q must be above 0.`;
    }
  }
  return null;
}

/** A sensible starting band for the "Add band" button. */
export function defaultBand(type: BandType): Band {
  switch (type) {
    case 'tilt':
      return { type, enabled: true, slope: 0.7, pivot: 1000, fLow: 20, fHigh: 20000 };
    case 'lowShelf':
      return { type, enabled: true, gain: 3, freq: 100, q: 0.707 };
    case 'highShelf':
      return { type, enabled: true, gain: -3, freq: 8000, q: 0.707 };
    case 'bell':
      return { type, enabled: true, gain: -3, freq: 3000, q: 1 };
  }
}

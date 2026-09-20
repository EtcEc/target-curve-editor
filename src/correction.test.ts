import { describe, it, expect } from 'vitest';
import {
  CorrectionValidationError,
  DEFAULT_CUTOFF_HZ,
  buildChannelTrims,
  createCorrection,
  parseCorrection,
  serializeCorrection,
  summarizeCorrection,
  trimFromError,
  type CorrectionFile,
} from './correction';
import { logGrid } from './measuredError';

function sample(): CorrectionFile {
  const error = logGrid().map((_, i) => i * 0.01);
  return createCorrection({ FL: { positions: 3, error } }, 'test mic', new Date('2026-09-20T12:00:00Z'));
}

/** parseCorrection on a modified copy of a valid file. */
function parseWith(mutate: (raw: Record<string, any>) => void): CorrectionFile {
  const raw = JSON.parse(serializeCorrection(sample()));
  mutate(raw);
  return parseCorrection(JSON.stringify(raw));
}

describe('createCorrection', () => {
  it('stamps version, label, timestamp and the shared grid', () => {
    const c = sample();
    expect(c.version).toBe(1);
    expect(c.label).toBe('test mic');
    expect(c.created).toBe('2026-09-20T12:00:00.000Z');
    expect(c.freq).toEqual(logGrid());
    expect(c.channels.FL.positions).toBe(3);
  });
});

describe('serializeCorrection / parseCorrection', () => {
  it('round-trips', () => {
    const c = sample();
    expect(parseCorrection(serializeCorrection(c))).toEqual(c);
  });

  it('defaults a missing label to an empty string', () => {
    expect(parseWith((raw) => delete raw.label).label).toBe('');
  });
});

describe('parseCorrection validation', () => {
  it('rejects text that is not JSON', () => {
    expect(() => parseCorrection('{nope')).toThrow(CorrectionValidationError);
  });

  it('rejects a non-object top level', () => {
    expect(() => parseCorrection('[1,2]')).toThrow(CorrectionValidationError);
  });

  it('rejects an unsupported version', () => {
    expect(() => parseWith((raw) => (raw.version = 2))).toThrow(/version/);
  });

  it('rejects a missing timestamp', () => {
    expect(() => parseWith((raw) => delete raw.created)).toThrow(/created/);
  });

  it('rejects a freq array that is not ascending', () => {
    expect(() => parseWith((raw) => ([raw.freq[3], raw.freq[4]] = [raw.freq[4], raw.freq[3]]))).toThrow(/ascending/);
  });

  it('rejects a valid-but-different freq grid', () => {
    expect(() =>
      parseWith((raw) => {
        raw.freq = [20, 200, 2000, 20000];
        raw.channels.FL.error = [0, 0, 0, 0];
      })
    ).toThrow(/shared .*-point 20 Hz/);
  });

  it('rejects non-finite or non-positive frequencies', () => {
    expect(() => parseWith((raw) => (raw.freq[0] = -5))).toThrow(CorrectionValidationError);
    expect(() => parseWith((raw) => (raw.freq[2] = 'x'))).toThrow(CorrectionValidationError);
  });

  it('rejects a channels value that is not an object', () => {
    expect(() => parseWith((raw) => (raw.channels = []))).toThrow(/channels/);
  });

  it('rejects an error array of the wrong length, naming the channel', () => {
    expect(() => parseWith((raw) => raw.channels.FL.error.pop())).toThrow(/FL/);
  });

  it('rejects non-finite error values', () => {
    expect(() => parseWith((raw) => (raw.channels.FL.error[5] = null))).toThrow(/FL/);
  });

  it('rejects a bad positions count', () => {
    expect(() => parseWith((raw) => (raw.channels.FL.positions = 0))).toThrow(/positions/);
    expect(() => parseWith((raw) => (raw.channels.FL.positions = 2.5))).toThrow(/positions/);
  });
});

describe('trimFromError', () => {
  const freq = logGrid();
  const flat = (v: number) => freq.map(() => v);

  it('rejects a cutoff that is not a positive finite number', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => trimFromError(flat(1), freq, bad)).toThrow(/cutoff/i);
    }
  });

  it('defaults the cutoff to 2 kHz', () => {
    expect(DEFAULT_CUTOFF_HZ).toBe(2000);
  });

  it('is zero below the fade, half at the cutoff and full above it (for a flat error)', () => {
    const trim = trimFromError(flat(2), freq, 2000);
    expect(trim(1000)).toBeCloseTo(0, 6);
    expect(trim(2000)).toBeCloseTo(-1, 1);
    expect(trim(2900)).toBeCloseTo(-2, 2);
    expect(trim(10000)).toBeCloseTo(-2, 6);
    expect(trim(20000)).toBeCloseTo(-2, 6);
  });

  it('is the negative of the error (a positive error gives a cut, a negative one a boost)', () => {
    expect(trimFromError(flat(-2), freq, 2000)(10000)).toBeCloseTo(2, 6);
  });

  it('clamps to +/-3 dB', () => {
    expect(trimFromError(flat(10), freq, 2000)(10000)).toBeCloseTo(-3, 6);
    expect(trimFromError(flat(-10), freq, 2000)(10000)).toBeCloseTo(3, 6);
  });

  it('moves the fade with the cutoff', () => {
    const trim = trimFromError(flat(2), freq, 4000);
    expect(trim(2000)).toBeCloseTo(0, 6);
    expect(trim(8000)).toBeCloseTo(-2, 6);
  });

  it('smooths a single-point spike instead of chasing it', () => {
    const error = flat(0);
    error[freq.findIndex((f) => f >= 8000)] = 10;
    const trim = trimFromError(error, freq, 2000);
    for (const f of freq) expect(Math.abs(trim(f))).toBeLessThan(0.5);
  });

  it('interpolates between grid points and clamps beyond the ends', () => {
    const error = freq.map((f) => (f >= 5000 ? 2 : 0));
    const trim = trimFromError(error, freq, 1000);
    const between = trim(Math.sqrt(freq[100] * freq[101]));
    const lo = Math.min(trim(freq[100]), trim(freq[101]));
    const hi = Math.max(trim(freq[100]), trim(freq[101]));
    expect(between).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(between).toBeLessThanOrEqual(hi + 1e-9);
    expect(trim(50000)).toBeCloseTo(trim(20000), 9);
    expect(trim(5)).toBeCloseTo(trim(20), 9);
  });
});

describe('buildChannelTrims / summarizeCorrection', () => {
  const freq = logGrid();
  const correction: CorrectionFile = createCorrection(
    {
      FL: { positions: 3, error: freq.map(() => 2) },
      FR: { positions: 2, error: freq.map(() => -1) },
    },
    '',
    new Date('2026-09-20T12:00:00Z')
  );

  it('builds one trim function per channel', () => {
    const trims = buildChannelTrims(correction, 2000);
    expect([...trims.keys()].sort()).toEqual(['FL', 'FR']);
    expect(trims.get('FL')!(10000)).toBeCloseTo(-2, 6);
    expect(trims.get('FR')!(10000)).toBeCloseTo(1, 6);
  });

  it('summarises positions and the largest trim per channel', () => {
    const rows = summarizeCorrection(correction, 2000, ['FL', 'FR', 'C']);
    const fl = rows.find((r) => r.commandId === 'FL')!;
    expect(fl.positions).toBe(3);
    expect(fl.maxAbsTrim).toBeCloseTo(2, 6);
    expect(fl.inBase).toBe(true);
  });

  it('flags channels the base file does not have', () => {
    const rows = summarizeCorrection(correction, 2000, ['FL', 'C']);
    expect(rows.find((r) => r.commandId === 'FR')!.inBase).toBe(false);
  });

  it('treats every channel as present when no base file is loaded yet', () => {
    const rows = summarizeCorrection(correction, 2000, []);
    expect(rows.every((r) => r.inBase)).toBe(true);
  });

  it('reports a smaller largest trim for a higher cutoff', () => {
    const low = summarizeCorrection(correction, 2000, [])[0].maxAbsTrim;
    const none = summarizeCorrection(correction, 60000, [])[0].maxAbsTrim;
    expect(low).toBeGreaterThan(none);
  });
});

import { describe, it, expect } from 'vitest';
import {
  CorrectionValidationError,
  createCorrection,
  parseCorrection,
  serializeCorrection,
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

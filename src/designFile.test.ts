import { describe, expect, it } from 'vitest';
import { DesignFileError, designFilename, parseDesign, serializeDesign } from './designFile';
import { presetBands, DEFAULT_PRESET_NAME } from './presets';

const bands = () => presetBands(DEFAULT_PRESET_NAME);

describe('serializeDesign / parseDesign', () => {
  it('round-trips name, bands and cancelRolloff', () => {
    const text = serializeDesign('My target', bands(), false);
    const parsed = parseDesign(text);
    expect(parsed.name).toBe('My target');
    expect(parsed.cancelRolloff).toBe(false);
    expect(parsed.bands).toEqual(bands());
  });

  it('writes version 1 and does not include the rolloff type', () => {
    const raw = JSON.parse(serializeDesign('x', bands(), true));
    expect(raw.version).toBe(1);
    expect(Object.keys(raw).sort()).toEqual(['bands', 'cancelRolloff', 'name', 'version']);
  });

  it('keeps disabled bands and every band type', () => {
    const all = [
      { type: 'tilt', enabled: false, slope: 1, pivot: 500, fLow: 30, fHigh: 15000 },
      { type: 'lowShelf', enabled: true, gain: 2, freq: 80, q: 0.7 },
      { type: 'highShelf', enabled: true, gain: -2, freq: 9000, q: 0.5 },
      { type: 'bell', enabled: true, gain: 1.5, freq: 250, q: 3 },
    ] as const;
    const parsed = parseDesign(serializeDesign('all', [...all], true));
    expect(parsed.bands).toEqual(all);
  });

  it('accepts an empty design (flat)', () => {
    expect(parseDesign(serializeDesign('flat', [], true)).bands).toEqual([]);
  });

  it('defaults a missing name to an empty string and a missing cancelRolloff to true', () => {
    const parsed = parseDesign(JSON.stringify({ version: 1, bands: [] }));
    expect(parsed.name).toBe('');
    expect(parsed.cancelRolloff).toBe(true);
  });

  it('drops fields it does not know instead of carrying them into the model', () => {
    const raw = JSON.parse(serializeDesign('x', bands(), true));
    raw.bands[0].extra = 'nope';
    expect(parseDesign(JSON.stringify(raw)).bands[0]).not.toHaveProperty('extra');
  });
});

describe('parseDesign rejects', () => {
  const bad = (value: unknown) => () => parseDesign(typeof value === 'string' ? value : JSON.stringify(value));

  it('text that is not JSON', () => {
    expect(bad('{nope')).toThrow(DesignFileError);
    expect(bad('{nope')).toThrow(/JSON/);
  });

  it('a top level that is not an object', () => {
    expect(bad([])).toThrow(DesignFileError);
    expect(bad(3)).toThrow(DesignFileError);
  });

  it('an unsupported version', () => {
    expect(bad({ version: 2, bands: [] })).toThrow(/version/);
    expect(bad({ bands: [] })).toThrow(/version/);
  });

  it('bands that are not an array', () => {
    expect(bad({ version: 1, bands: 'x' })).toThrow(/bands/);
  });

  it('an unknown band type', () => {
    expect(bad({ version: 1, bands: [{ type: 'wobble', enabled: true }] })).toThrow(/Band 1/);
  });

  it('a band with a missing or non-numeric value', () => {
    const shelf = { type: 'lowShelf', enabled: true, gain: 2, freq: 80 }; // no q
    expect(bad({ version: 1, bands: [shelf] })).toThrow(/Band 1/);
    expect(bad({ version: 1, bands: [{ ...shelf, q: '0.7' }] })).toThrow(/Band 1/);
    expect(bad({ version: 1, bands: [{ ...shelf, q: null }] })).toThrow(/Band 1/);
  });

  it('a band with a non-boolean enabled flag', () => {
    expect(bad({ version: 1, bands: [{ type: 'bell', enabled: 'yes', gain: 1, freq: 100, q: 1 }] })).toThrow(/Band 1/);
  });

  it('bands that fail the same validation as the editor (zero Q, tilt range reversed)', () => {
    expect(bad({ version: 1, bands: [{ type: 'bell', enabled: true, gain: 1, freq: 100, q: 0 }] })).toThrow(/Q/);
    const tilt = { type: 'tilt', enabled: true, slope: 1, pivot: 1000, fLow: 5000, fHigh: 100 };
    expect(bad({ version: 1, bands: [tilt] })).toThrow(/hold below/);
  });

  it('a non-boolean cancelRolloff', () => {
    expect(bad({ version: 1, bands: [], cancelRolloff: 'no' })).toThrow(/cancelRolloff/);
  });
});

describe('designFilename', () => {
  it('makes a safe .json name from the design name', () => {
    expect(designFilename('My Target #2!')).toBe('design_My-Target-2.json');
  });

  it('falls back to a plain name when the design name is empty or all symbols', () => {
    expect(designFilename('')).toBe('design.json');
    expect(designFilename('***')).toBe('design.json');
  });

  it('keeps a long name reasonable', () => {
    expect(designFilename('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

import { describe, expect, it } from 'vitest';
import { sumBands, type BellBand, type Band, type ShelfBand } from './bands';
import { MAX_Q, MIN_Q, dragBand, handleFor, scaleQ } from './handles';

const none = () => 0;
const shelf = (over: Partial<ShelfBand> = {}): Band => ({
  type: 'lowShelf',
  enabled: true,
  gain: 4,
  freq: 80,
  q: 0.7,
  ...over,
});
const bell = (over: Partial<BellBand> = {}): Band => ({
  type: 'bell',
  enabled: true,
  gain: -3,
  freq: 3000,
  q: 1,
  ...over,
});
const tilt: Band = { type: 'tilt', enabled: true, slope: 0.7, pivot: 1000, fLow: 50, fHigh: 20000 };

describe('handleFor', () => {
  it('sits on the design curve at the band frequency', () => {
    const bands = [tilt, shelf()];
    const h = handleFor(bands, 1, none);
    expect(h?.freq).toBe(80);
    expect(h?.y).toBeCloseTo(sumBands(80, bands), 9);
  });

  it('sits on the plotted curve, so it includes the chart offset (rolloff left on)', () => {
    const bands = [bell()];
    const h = handleFor(bands, 0, (f) => (f > 1000 ? -2 : 0));
    expect(h?.y).toBeCloseTo(-3 - 2, 9);
  });

  it('has no handle for a tilt or a disabled band', () => {
    expect(handleFor([tilt], 0, none)).toBeNull();
    expect(handleFor([bell({ enabled: false })], 0, none)).toBeNull();
  });
});

describe('dragBand', () => {
  it('puts a lone bell exactly where the pointer is', () => {
    const bands = [bell()];
    const next = dragBand(bands, 0, 1200, 4, none);
    const after: Band[] = [{ ...bands[0], ...next } as Band];
    expect(next.freq).toBeCloseTo(1200, -1);
    expect(sumBands(next.freq, after)).toBeCloseTo(4, 1);
  });

  it('puts a lone shelf under the pointer too (its gain is twice the height at its own frequency)', () => {
    const bands = [shelf()];
    const next = dragBand(bands, 0, 100, 2.5, none);
    expect(next.gain).toBeCloseTo(5, 1);
    const after: Band[] = [{ ...bands[0], ...next } as Band];
    expect(sumBands(next.freq, after)).toBeCloseTo(2.5, 1);
  });

  it('accounts for the other bands, so the total at the handle lands on the pointer', () => {
    const bands = [tilt, shelf(), bell({ freq: 200, gain: 2 })];
    const next = dragBand(bands, 1, 90, 6, none);
    const after = bands.map((b, i) => (i === 1 ? ({ ...b, ...next } as Band) : b));
    expect(sumBands(next.freq, after)).toBeCloseTo(6, 1);
  });

  it('subtracts the chart offset, so the drawn curve (design + rolloff) lands on the pointer', () => {
    const offset = (f: number) => (f > 1000 ? -2 : 0);
    const bands = [bell()];
    const next = dragBand(bands, 0, 5000, 1, offset);
    // the plotted value is design + offset(f); the design must be 3 dB for the plot to read 1 dB
    expect(next.gain).toBeCloseTo(3, 1);
  });

  it('keeps the frequency inside the chart', () => {
    expect(dragBand([bell()], 0, 5, 0, none).freq).toBe(20);
    expect(dragBand([bell()], 0, 90000, 0, none).freq).toBe(20000);
  });

  it('keeps the gain finite and bounded when dragged far off the chart', () => {
    const g = dragBand([bell()], 0, 1000, 1e9, none).gain;
    expect(Number.isFinite(g)).toBe(true);
    expect(Math.abs(g)).toBeLessThanOrEqual(24);
  });

  it('rounds to values that read cleanly in the fields', () => {
    const next = dragBand([bell()], 0, 1234.5678, 1.23456, none);
    expect(next.freq).toBe(1230);
    expect(next.gain).toBe(Math.round(next.gain * 10) / 10);
  });

  it('leaves the band as it is when another band makes the sum unusable (no NaN written)', () => {
    const bands = [bell(), bell({ q: 0, freq: 500 })];
    const next = dragBand(bands, 0, 1000, 2, none);
    expect(next).toEqual({ freq: 3000, gain: -3 });
  });

  it('does not touch the band list', () => {
    const bands = [bell()];
    const snapshot = JSON.stringify(bands);
    dragBand(bands, 0, 500, 2, none);
    expect(JSON.stringify(bands)).toBe(snapshot);
  });
});

describe('scaleQ', () => {
  it('raises Q when scrolling up and lowers it when scrolling down, by about 10% a step', () => {
    expect(scaleQ(1, -100)).toBeCloseTo(1.1, 6);
    expect(scaleQ(1, 100)).toBeCloseTo(1 / 1.1, 6);
  });

  it('scales with how far the wheel moved, so a small trackpad scroll is a small change', () => {
    expect(scaleQ(1, -50)).toBeCloseTo(1.1 ** 0.5, 6);
    expect(scaleQ(1, 10)).toBeCloseTo(1.1 ** -0.1, 6);
  });

  it('caps one event at three notches', () => {
    expect(scaleQ(1, -100000)).toBeCloseTo(1.1 ** 3, 6);
  });

  it('is clamped to a usable range', () => {
    expect(scaleQ(MAX_Q, -100)).toBe(MAX_Q);
    expect(scaleQ(MIN_Q, 100)).toBe(MIN_Q);
  });

  it('leaves Q alone for a zero scroll', () => {
    expect(scaleQ(2, 0)).toBe(2);
  });
});

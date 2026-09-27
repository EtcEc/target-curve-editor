import { describe, expect, it } from 'vitest';
import { buildFilenameSuffix, designChecklist } from './downloadSummary';
import { testParams } from './fixtures/testParams';

const DEFAULT_CURVE = '0.7 dB/oct tilt (held below 50 Hz), +1.43 dB low shelf at 66.5 Hz';

describe('designChecklist', () => {
  it('lists the curve, the cancelled rolloff and the sub trim for the default design', () => {
    expect(designChecklist(testParams(), ['SW1'], 6.27)).toEqual([
      { text: `Curve: ${DEFAULT_CURVE}`, on: true },
      { text: 'HF rolloff 2 cancelled', on: true },
      { text: 'Sub trim +6.27 dB on SW1', on: true },
    ]);
  });

  it('marks a rolloff that is left on', () => {
    expect(designChecklist(testParams({ rolloffType: 1, cancelRolloff: false }), ['SW1'], 0)[1]).toEqual({
      text: 'HF rolloff 1 left on',
      on: false,
    });
  });

  it('marks a skipped sub trim', () => {
    expect(designChecklist(testParams({ subTrim: false }), ['SW1'], 6.27)[2]).toEqual({
      text: 'Sub trim skipped',
      on: false,
    });
  });

  it('says when there is no subwoofer', () => {
    expect(designChecklist(testParams(), [], 6.27)[2]).toEqual({ text: 'No subwoofer, so no sub trim', on: false });
  });

  it('names every sub', () => {
    expect(designChecklist(testParams(), ['SW1', 'SW2'], 1.5)[2].text).toBe('Sub trim +1.5 dB on SW1, SW2');
  });

  it('describes every band type and skips disabled bands', () => {
    const params = testParams({
      bands: [
        { type: 'tilt', enabled: true, slope: 1, pivot: 1000, fLow: 20, fHigh: 20000 },
        { type: 'highShelf', enabled: true, gain: -2, freq: 8000, q: 0.707 },
        { type: 'bell', enabled: true, gain: -3, freq: 3000, q: 1.4 },
        { type: 'lowShelf', enabled: false, gain: 5, freq: 60, q: 0.707 },
      ],
    });
    expect(designChecklist(params, ['SW1'], 0)[0].text).toBe(
      'Curve: 1 dB/oct tilt, -2 dB high shelf at 8000 Hz, -3 dB bell at 3000 Hz (Q 1.4)'
    );
  });

  it('says flat when there are no enabled bands', () => {
    expect(designChecklist(testParams({ bands: [] }), ['SW1'], 0)[0].text).toBe('Curve: flat');
  });
});

describe('buildFilenameSuffix', () => {
  it('is empty for the default settings', () => {
    expect(buildFilenameSuffix(testParams())).toBe('');
  });

  it('orders the suffixes no-knee-cancel, no-sub-trim', () => {
    expect(buildFilenameSuffix(testParams({ cancelRolloff: false, subTrim: false }))).toBe(
      '_no-knee-cancel_no-sub-trim'
    );
  });

  it('adds only what applies', () => {
    expect(buildFilenameSuffix(testParams({ subTrim: false }))).toBe('_no-sub-trim');
  });
});

import { describe, expect, it } from 'vitest';
import { buildDownloadSummary, buildFilenameSuffix } from './downloadSummary';
import { testParams } from './fixtures/testParams';

const DEFAULT_CURVE = '0.7 dB/oct tilt (held below 50 Hz), +1.43 dB low shelf at 66.5 Hz';

describe('buildDownloadSummary', () => {
  it('describes the default design with no correction and everything applied', () => {
    expect(buildDownloadSummary(testParams(), [], 2000)).toBe(
      `Contains: ${DEFAULT_CURVE}; no measured correction; sub trim applied; HF rolloff 2 cancelled.`
    );
  });

  it('lists only the channels that get a trim, with the cutoff', () => {
    expect(buildDownloadSummary(testParams(), ['FL', 'FR', 'C'], 2000)).toContain(
      'measured trim on FL, FR, C above 2000 Hz'
    );
  });

  it('says no measured correction when apply is unticked or the cutoff is null', () => {
    expect(buildDownloadSummary(testParams(), [], null)).toContain('no measured correction');
    expect(buildDownloadSummary(testParams(), ['FL'], null)).toContain('no measured correction');
  });

  it('states when the sub trim is skipped', () => {
    expect(buildDownloadSummary(testParams({ subTrim: false }), [], null)).toContain('sub trim skipped');
  });

  it('states the rolloff type and whether it is cancelled', () => {
    expect(buildDownloadSummary(testParams({ rolloffType: 1, cancelRolloff: false }), [], null)).toContain(
      'HF rolloff 1 not cancelled'
    );
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
    expect(buildDownloadSummary(params, [], null)).toContain(
      'Contains: 1 dB/oct tilt, -2 dB high shelf at 8000 Hz, -3 dB bell at 3000 Hz (Q 1.4);'
    );
  });

  it('says flat when there are no enabled bands', () => {
    expect(buildDownloadSummary(testParams({ bands: [] }), [], null)).toContain('Contains: flat curve;');
  });
});

describe('buildFilenameSuffix', () => {
  it('is empty for the default settings without trims', () => {
    expect(buildFilenameSuffix(testParams(), false)).toBe('');
  });

  it('orders the suffixes no-knee-cancel, no-sub-trim, measured-trim', () => {
    expect(buildFilenameSuffix(testParams({ cancelRolloff: false, subTrim: false }), true)).toBe(
      '_no-knee-cancel_no-sub-trim_measured-trim'
    );
  });

  it('adds only what applies', () => {
    expect(buildFilenameSuffix(testParams({ subTrim: false }), false)).toBe('_no-sub-trim');
    expect(buildFilenameSuffix(testParams(), true)).toBe('_measured-trim');
  });
});

import { describe, expect, it } from 'vitest';
import { buildDownloadSummary } from './downloadSummary';

const base = { slope: 0.7, shelfEnabled: true, shelfGain: 4.5, cancelHfKnee: true };

describe('buildDownloadSummary', () => {
  it('states no measured correction when none is applied', () => {
    expect(buildDownloadSummary(base, [], 2000)).toBe(
      'Contains: 0.7 dB/oct tilt + 4.5 dB bass shelf; no measured correction.'
    );
  });

  it('lists only the channels that get a trim, with the cutoff', () => {
    expect(buildDownloadSummary(base, ['FL', 'FR', 'C'], 2000)).toBe(
      'Contains: 0.7 dB/oct tilt + 4.5 dB bass shelf; measured trim on FL, FR, C above 2000 Hz.'
    );
  });

  it('says no measured correction when apply is unticked (no trimmed channels)', () => {
    expect(buildDownloadSummary(base, [], null)).toContain('no measured correction.');
  });

  it('mentions HF rolloff cancellation off', () => {
    expect(buildDownloadSummary({ ...base, cancelHfKnee: false }, [], 2000)).toBe(
      'Contains: 0.7 dB/oct tilt + 4.5 dB bass shelf; no measured correction; HF rolloff cancellation off.'
    );
  });

  it('omits the shelf when off', () => {
    expect(buildDownloadSummary({ ...base, shelfEnabled: false }, ['FL'], 500)).toBe(
      'Contains: 0.7 dB/oct tilt, no bass shelf; measured trim on FL above 500 Hz.'
    );
  });

  it('says no measured correction when channels are trimmed but cutoff is null', () => {
    expect(buildDownloadSummary(base, ['FL', 'FR'], null)).toContain('no measured correction.');
  });

  it('handles shelf off together with knee cancellation off', () => {
    expect(buildDownloadSummary({ ...base, shelfEnabled: false, cancelHfKnee: false }, [], null)).toBe(
      'Contains: 0.7 dB/oct tilt, no bass shelf; no measured correction; HF rolloff cancellation off.'
    );
  });
});

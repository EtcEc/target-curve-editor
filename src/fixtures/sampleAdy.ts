import type { AdyFile } from '../ady';

/**
 * Small synthetic .ady fixture for tests -- structurally matches a real
 * file (a non-sub channel, a subwoofer channel, dummy responseData) but
 * contains no real calibration data. Real .ady files are gitignored and
 * must never be used as a committed test fixture.
 */
export function createSampleAdy(): AdyFile {
  return {
    title: 'Sample',
    enTargetCurveType: 0,
    detectedChannels: [
      {
        commandId: 'FL',
        customTargetCurvePoints: [],
        trimAdjustment: '0.500000',
        customSpeakerType: 'S',
        responseData: { 0: [1, 2, 3] },
      },
      {
        commandId: 'SW1',
        customTargetCurvePoints: [],
        trimAdjustment: '-1.250000',
        customSpeakerType: 'S',
        responseData: { 0: [4, 5, 6] },
      },
    ],
  };
}

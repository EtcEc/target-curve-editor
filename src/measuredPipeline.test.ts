import { describe, expect, it } from 'vitest';
import { applyCurveToAdy, applyMeasuredCorrection, type AdyChannel, type AdyFile } from './ady';
import { buildChannelTrims } from './correction';
import { readCurvePoints } from './curvePoints';
import { createSampleAdy } from './fixtures/sampleAdy';
import { synthRewText } from './fixtures/synthMeasurement';
import { testParams } from './fixtures/testParams';
import { measureCorrection } from './generate';
import { interpLogFreq } from './logInterp';
import { effectiveTarget, logGrid } from './measuredError';

function channel(ady: AdyFile, commandId: string): AdyChannel {
  const found = ady.detectedChannels.find((c) => c.commandId === commandId);
  if (!found) throw new Error(`no channel ${commandId}`);
  return found;
}

describe('measured-correction pipeline, end to end', () => {
  it('leaves a channel unchanged when its measurement matches the designed curve exactly', () => {
    const designed = applyCurveToAdy(createSampleAdy(), testParams());
    const fl = channel(designed, 'FL');

    // A synthetic REW measurement whose shape is exactly the file's own effective
    // target for FL, plus an arbitrary level offset (a matching measurement needs
    // no correction regardless of the absolute SPL it was taken at).
    const grid = logGrid();
    const target = effectiveTarget(fl, 2);
    const text = synthRewText((f) => 70 + interpLogFreq(grid, target, f));

    const { correction } = measureCorrection(designed, [{ commandId: 'FL', files: [{ name: 'L.txt', text }] }]);
    const corrected = applyMeasuredCorrection(designed, buildChannelTrims(correction, 500));

    const before = readCurvePoints(fl);
    const after = readCurvePoints(channel(corrected, 'FL'));
    expect(after.freqs).toEqual(before.freqs);

    let maxDiff = 0;
    for (let i = 0; i < before.gains.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(after.gains[i] - before.gains[i]));
    }
    expect(maxDiff).toBeLessThan(0.05);

    // SW1 (untouched by applyMeasuredCorrection) and every channel's trimAdjustment
    // must come through unchanged.
    expect(channel(corrected, 'SW1')).toEqual(channel(designed, 'SW1'));
    for (const c of designed.detectedChannels) {
      expect(channel(corrected, c.commandId).trimAdjustment).toBe(c.trimAdjustment);
    }
  });
});

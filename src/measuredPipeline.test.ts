import { describe, expect, it } from 'vitest';
import { applyCurveToAdy, applyMeasuredCorrection, type AdyChannel, type AdyFile } from './ady';
import { buildChannelTrims } from './correction';
import { smoothstep } from './curve';
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

    const { correction } = measureCorrection(designed, designed, [{ commandId: 'FL', files: [{ name: 'L.txt', text }] }]);
    const corrected = applyMeasuredCorrection(designed, designed, buildChannelTrims(correction, 500), 3);

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

describe('multi-round correction', () => {
  const grid = logGrid();
  /** A broad treble error Audyssey keeps missing: 0 below 2 kHz, rising to +1.5 dB at 8 kHz and above. */
  const bias = (f: number) => 1.5 * smoothstep(Math.log2(f / 2000) / 2);
  const designed = applyCurveToAdy(createSampleAdy(), testParams());
  const target = effectiveTarget(channel(designed, 'FL'), 2);
  /** A measurement that lands on the target plus `amount` times the bias. */
  const measured = (amount: number) => [
    { name: 'L.txt', text: synthRewText((f) => 70 + interpLogFreq(grid, target, f) + amount * bias(f)) },
  ];
  const gainAt = (ady: AdyFile, f: number) => {
    const { freqs, gains } = readCurvePoints(channel(ady, 'FL'));
    return gains[freqs.indexOf(f)];
  };
  const round = (measuredWith: AdyFile, amount: number) => {
    const { correction } = measureCorrection(designed, measuredWith, [{ commandId: 'FL', files: measured(amount) }]);
    return applyMeasuredCorrection(designed, measuredWith, buildChannelTrims(correction, 500), 3);
  };

  it('round 1 cuts the bias', () => {
    const round1 = round(designed, 1);
    expect(gainAt(round1, 12000) - gainAt(designed, 12000)).toBeCloseTo(-1.5, 1);
  });

  it('round 2 changes nothing once the measurement hits the target', () => {
    const round1 = round(designed, 1);
    const round2 = round(round1, 0);
    const before = readCurvePoints(channel(round1, 'FL')).gains;
    const after = readCurvePoints(channel(round2, 'FL')).gains;
    let maxDiff = 0;
    for (let i = 0; i < before.length; i++) maxDiff = Math.max(maxDiff, Math.abs(after[i] - before[i]));
    expect(maxDiff).toBeLessThan(0.05);
  });

  it('round 2 adds only what is still off', () => {
    const round1 = round(designed, 1);
    const round2 = round(round1, 0.5);
    expect(gainAt(round2, 12000) - gainAt(round1, 12000)).toBeCloseTo(-0.75, 1);
    expect(gainAt(round2, 12000) - gainAt(designed, 12000)).toBeCloseTo(-2.25, 1);
  });
});

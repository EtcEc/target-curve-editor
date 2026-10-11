import { describe, it, expect } from 'vitest';
import type { AdyFile } from './ady';
import { createSampleAdy } from './fixtures/sampleAdy';
import { synthRewText } from './fixtures/synthMeasurement';
import { GenerateError, checkFilePair, checkMeasuredType, measureCorrection } from './generate';
import { rolloffGain } from './rolloff';
import { logGrid } from './measuredError';
import { RewParseError } from './rewParse';

/** A flat (0 dB) custom curve on the log grid. */
const FLAT = logGrid().map((f) => `{${f.toFixed(3)}, 0.000}`);

function measuredAdy(): AdyFile {
  const ady = createSampleAdy(); // FL and SW1
  ady.enTargetCurveType = 2;
  ady.detectedChannels[0].customTargetCurvePoints = [...FLAT];
  ady.detectedChannels.push({ commandId: 'FR', customTargetCurvePoints: [...FLAT], trimAdjustment: '0.000000' });
  return ady;
}

// The target is flat + knee, so "flat + knee + bump" measures as an error equal to the bump.
const bump = (f: number) => 1.5 * Math.exp(-(Math.log2(f / 8000) ** 2) / (2 * 0.3 ** 2));
const measuredFn = (f: number) => 70 + rolloffGain(2, f) + bump(f);
const file = (name: string, fn = measuredFn) => ({ name, text: synthRewText(fn) });
const at8k = () => logGrid().findIndex((f) => f >= 8000);

describe('measureCorrection', () => {
  it('measures the planted error with the averaged position count', () => {
    const { correction, reports, warnings } = measureCorrection(measuredAdy(), measuredAdy(), [
      { commandId: 'FL', files: [file('L1.txt'), file('L2.txt')] },
    ]);
    expect(Object.keys(correction)).toEqual(['FL']);
    expect(correction.FL.positions).toBe(2);
    expect(correction.FL.error[at8k()]).toBeCloseTo(1.5, 1);
    expect(reports).toHaveLength(1);
    expect(reports[0].commandId).toBe('FL');
    expect(reports[0].positions).toBe(2);
    expect(Number.isFinite(reports[0].rmsError)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('accepts REW files that carry a phase column', () => {
    const phased = { name: 'L1.txt', text: synthRewText(measuredFn, 1500, true) };
    expect(measureCorrection(measuredAdy(), measuredAdy(), [{ commandId: 'FL', files: [phased] }]).correction.FL.positions).toBe(1);
  });

  it('skips speakers with no files but processes the others', () => {
    const { correction } = measureCorrection(measuredAdy(), measuredAdy(), [
      { commandId: 'FL', files: [file('L1.txt')] },
      { commandId: 'FR', files: [] },
    ]);
    expect(Object.keys(correction)).toEqual(['FL']);
  });

  it('refuses a .ady with an unsupported enTargetCurveType', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 0;
    const run = () => measureCorrection(ady, ady, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/enTargetCurveType 0/);
  });

  it('uses the Roll Off 1 shape for a type-1 .ady', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 1;
    const one = (f: number) => 70 + rolloffGain(1, f) + bump(f);
    const { correction, warnings } = measureCorrection(ady, ady, [{ commandId: 'FL', files: [file('L1.txt', one)] }]);
    expect(correction.FL.error[at8k()]).toBeCloseTo(1.5, 1);
    expect(warnings).toEqual([]);
  });

  it('a Roll Off 2 measurement read as type 1 shows the difference between the shapes', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 1;
    const { correction } = measureCorrection(ady, ady, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    // 12.5 kHz: Roll Off 2 is about 1.5 dB lower than Roll Off 1 there, and the 8 kHz test bump is negligible
    expect(correction.FL.error[logGrid().findIndex((f) => f >= 12500)]).toBeLessThan(-1);
  });

  it('checkMeasuredType returns the type for 1 and 2 and refuses everything else naming the supported values', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 1;
    expect(checkMeasuredType(ady)).toBe(1);
    ady.enTargetCurveType = 2;
    expect(checkMeasuredType(ady)).toBe(2);
    ady.enTargetCurveType = 3;
    expect(() => checkMeasuredType(ady)).toThrow(GenerateError);
    expect(() => checkMeasuredType(ady)).toThrow(/1 and 2/);
  });

  it('refuses a speaker whose channel has no target curve', () => {
    const ady = measuredAdy();
    ady.detectedChannels[0].customTargetCurvePoints = [];
    const run = () => measureCorrection(ady, ady, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    expect(run).toThrow(GenerateError);
    expect(run).toThrow(/FL has no target curve/);
  });

  it('throws when no speaker has any files', () => {
    expect(() => measureCorrection(measuredAdy(), measuredAdy(), [])).toThrow(GenerateError);
    expect(() => measureCorrection(measuredAdy(), measuredAdy(), [{ commandId: 'FL', files: [] }])).toThrow(/No measurement files/);
  });

  it('throws for a channel the .ady does not have', () => {
    expect(() => measureCorrection(measuredAdy(), measuredAdy(), [{ commandId: 'XX', files: [file('a.txt')] }])).toThrow(/XX/);
  });

  it('throws for the subwoofer', () => {
    expect(() => measureCorrection(measuredAdy(), measuredAdy(), [{ commandId: 'SW1', files: [file('a.txt')] }])).toThrow(
      /subwoofer/
    );
  });

  it('throws when a channel is given twice', () => {
    expect(() =>
      measureCorrection(measuredAdy(), measuredAdy(), [
        { commandId: 'FL', files: [file('a.txt')] },
        { commandId: 'FL', files: [file('b.txt')] },
      ])
    ).toThrow(/twice/);
  });

  it('warns when a speaker looks far off, without blocking', () => {
    const wild = (f: number) => 70 + rolloffGain(2, f) + (f > 3000 ? 10 : 0);
    const { correction, warnings } = measureCorrection(measuredAdy(), measuredAdy(), [
      { commandId: 'FL', files: [file('L1.txt', wild)] },
    ]);
    expect(correction.FL).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/FL/);
  });

  it('lets a parse error through, naming the file', () => {
    const run = () =>
      measureCorrection(measuredAdy(), measuredAdy(), [{ commandId: 'FL', files: [{ name: 'L3.txt', text: 'garbage' }] }]);
    expect(run).toThrow(RewParseError);
    expect(run).toThrow(/L3\.txt/);
  });
});

/** measuredAdy() with FL's curve raised by `db` above 2 kHz (as a round-1 output might be). */
function shifted(db: number): AdyFile {
  const ady = measuredAdy();
  ady.detectedChannels[0].customTargetCurvePoints = logGrid().map(
    (f) => `{${f.toFixed(3)}, ${(f >= 2000 ? db : 0).toFixed(3)}}`
  );
  return ady;
}

describe('measuring against the target with a separate measured-with file', () => {
  it('records no correction so far when both files are the same', () => {
    const ady = measuredAdy();
    const { correction } = measureCorrection(ady, ady, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    expect(correction.FL.soFar).toHaveLength(logGrid().length);
    expect(correction.FL.soFar.every((v) => v === 0)).toBe(true);
  });

  it('measures the error against the target, not the measured-with curve, and records the difference', () => {
    const { correction } = measureCorrection(measuredAdy(), shifted(1), [
      { commandId: 'FL', files: [file('L1.txt')] },
    ]);
    expect(correction.FL.error[at8k()]).toBeCloseTo(1.5, 1);
    expect(correction.FL.soFar[at8k()]).toBeCloseTo(1, 6);
    expect(correction.FL.soFar[logGrid().findIndex((f) => f >= 500)]).toBeCloseTo(0, 6);
  });

  it('refuses a speaker that has no curve in the measured-with file', () => {
    const withFile = measuredAdy();
    withFile.detectedChannels[0].customTargetCurvePoints = [];
    const run = () => measureCorrection(measuredAdy(), withFile, [{ commandId: 'FL', files: [file('L1.txt')] }]);
    expect(run).toThrow(GenerateError);
    expect(run).toThrow('Channel FL has no curve in the file you measured with.');
  });
});

describe('checkFilePair', () => {
  it('returns the shared rolloff type for the same file or matching files', () => {
    const ady = measuredAdy();
    expect(checkFilePair(ady, ady)).toBe(2);
    expect(checkFilePair(measuredAdy(), shifted(1))).toBe(2);
  });

  it('refuses different rolloff types', () => {
    const other = measuredAdy();
    other.enTargetCurveType = 1;
    expect(() => checkFilePair(measuredAdy(), other)).toThrow(
      'The two files use different HF rolloff types (2 and 1). Measure with a file made from this target.'
    );
  });

  it('refuses an unsupported type in either file', () => {
    const other = measuredAdy();
    other.enTargetCurveType = 0;
    expect(() => checkFilePair(measuredAdy(), other)).toThrow(/enTargetCurveType 0/);
  });

  it('lists the speakers that are only in one of the files, ignoring subs', () => {
    const target = measuredAdy();
    target.detectedChannels.push({ commandId: 'C', customTargetCurvePoints: [], trimAdjustment: '0.0' });
    const other = measuredAdy();
    other.detectedChannels.push({ commandId: 'SW2', customTargetCurvePoints: [], trimAdjustment: '0.0' });
    other.detectedChannels.push({ commandId: 'SLA', customTargetCurvePoints: [], trimAdjustment: '0.0' });
    expect(() => checkFilePair(target, other)).toThrow(
      'The two files have different speakers (only in the target: C; only in the measured-with file: SLA).'
    );
    expect(() => checkFilePair(measuredAdy(), other)).toThrow(
      'The two files have different speakers (only in the measured-with file: SLA).'
    );
  });
});

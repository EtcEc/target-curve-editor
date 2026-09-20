import { describe, it, expect } from 'vitest';
import type { AdyFile } from './ady';
import { createSampleAdy } from './fixtures/sampleAdy';
import { synthRewText } from './fixtures/synthMeasurement';
import { GenerateError, REQUIRED_TARGET_CURVE_TYPE, generateCorrection } from './generate';
import { hfKneeGain } from './hfKnee';
import { logGrid } from './measuredError';
import { RewParseError } from './rewParse';

function measuredAdy(): AdyFile {
  const ady = createSampleAdy(); // FL and SW1
  ady.enTargetCurveType = REQUIRED_TARGET_CURVE_TYPE;
  ady.detectedChannels.push({ commandId: 'FR', customTargetCurvePoints: [], trimAdjustment: '0.000000' });
  return ady;
}

// The stock target is the knee alone, so "flat + knee + bump" measures as an error equal to the bump.
const bump = (f: number) => 1.5 * Math.exp(-(Math.log2(f / 8000) ** 2) / (2 * 0.3 ** 2));
const measuredFn = (f: number) => 70 + hfKneeGain(f) + bump(f);
const file = (name: string, fn = measuredFn) => ({ name, text: synthRewText(fn) });
const NOW = new Date('2026-09-20T12:00:00Z');

describe('generateCorrection', () => {
  it('builds a correction with the averaged position count and the planted error', () => {
    const { correction, reports, warnings } = generateCorrection(
      measuredAdy(),
      [{ commandId: 'FL', files: [file('L1.txt'), file('L2.txt')] }],
      'test mic',
      NOW
    );
    const i = logGrid().findIndex((f) => f >= 8000);
    expect(Object.keys(correction.channels)).toEqual(['FL']);
    expect(correction.channels.FL.positions).toBe(2);
    expect(correction.channels.FL.error[i]).toBeCloseTo(1.5, 1);
    expect(correction.label).toBe('test mic');
    expect(correction.created).toBe(NOW.toISOString());
    expect(reports).toHaveLength(1);
    expect(reports[0].commandId).toBe('FL');
    expect(reports[0].positions).toBe(2);
    expect(Number.isFinite(reports[0].rmsError)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('accepts REW files that carry a phase column', () => {
    const phased = { name: 'L1.txt', text: synthRewText(measuredFn, 1500, true) };
    const { correction } = generateCorrection(measuredAdy(), [{ commandId: 'FL', files: [phased] }], '', NOW);
    expect(correction.channels.FL.positions).toBe(1);
  });

  it('skips speakers with no files but processes the others', () => {
    const { correction } = generateCorrection(
      measuredAdy(),
      [
        { commandId: 'FL', files: [file('L1.txt')] },
        { commandId: 'FR', files: [] },
      ],
      '',
      NOW
    );
    expect(Object.keys(correction.channels)).toEqual(['FL']);
  });

  it('refuses a measured .ady that is not enTargetCurveType 2', () => {
    const ady = measuredAdy();
    ady.enTargetCurveType = 0;
    expect(() => generateCorrection(ady, [{ commandId: 'FL', files: [file('L1.txt')] }], '')).toThrow(GenerateError);
    expect(() => generateCorrection(ady, [{ commandId: 'FL', files: [file('L1.txt')] }], '')).toThrow(/enTargetCurveType/);
  });

  it('throws when no speaker has any files', () => {
    expect(() => generateCorrection(measuredAdy(), [], '')).toThrow(GenerateError);
    expect(() => generateCorrection(measuredAdy(), [{ commandId: 'FL', files: [] }], '')).toThrow(/No measurement files/);
  });

  it('throws for a channel the .ady does not have', () => {
    expect(() => generateCorrection(measuredAdy(), [{ commandId: 'XX', files: [file('a.txt')] }], '')).toThrow(/XX/);
  });

  it('throws for the subwoofer', () => {
    expect(() => generateCorrection(measuredAdy(), [{ commandId: 'SW1', files: [file('a.txt')] }], '')).toThrow(/subwoofer/);
  });

  it('throws when a channel is given twice', () => {
    expect(() =>
      generateCorrection(
        measuredAdy(),
        [
          { commandId: 'FL', files: [file('a.txt')] },
          { commandId: 'FL', files: [file('b.txt')] },
        ],
        ''
      )
    ).toThrow(/twice/);
  });

  it('warns when a speaker looks far off, without blocking', () => {
    const wild = (f: number) => 70 + hfKneeGain(f) + (f > 3000 ? 10 : 0);
    const { correction, warnings } = generateCorrection(
      measuredAdy(),
      [{ commandId: 'FL', files: [file('L1.txt', wild)] }],
      '',
      NOW
    );
    expect(correction.channels.FL).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/FL/);
  });

  it('lets a parse error through, naming the file', () => {
    const run = () =>
      generateCorrection(measuredAdy(), [{ commandId: 'FL', files: [{ name: 'L3.txt', text: 'garbage' }] }], '');
    expect(run).toThrow(RewParseError);
    expect(run).toThrow(/L3\.txt/);
  });
});

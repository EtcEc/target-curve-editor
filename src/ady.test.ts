import { describe, it, expect } from 'vitest';
import { parseAdy, isSubwooferChannel, AdyValidationError } from './ady';
import { createSampleAdy } from './fixtures/sampleAdy';

describe('parseAdy', () => {
  it('parses a valid sample file', () => {
    const json = JSON.stringify(createSampleAdy());
    const parsed = parseAdy(json);
    expect(parsed.detectedChannels).toHaveLength(2);
    expect(parsed.enTargetCurveType).toBe(0);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseAdy('{not json')).toThrow(AdyValidationError);
  });

  it('rejects a file missing detectedChannels', () => {
    expect(() => parseAdy(JSON.stringify({ enTargetCurveType: 0 }))).toThrow(AdyValidationError);
  });

  it('rejects an empty detectedChannels array', () => {
    expect(() => parseAdy(JSON.stringify({ enTargetCurveType: 0, detectedChannels: [] }))).toThrow(
      AdyValidationError
    );
  });

  it('rejects a channel missing commandId', () => {
    const bad = createSampleAdy();
    // @ts-expect-error deliberately breaking the fixture for this test
    delete bad.detectedChannels[0].commandId;
    expect(() => parseAdy(JSON.stringify(bad))).toThrow(AdyValidationError);
  });

  it('reads a channel without customTargetCurvePoints as having no curve', () => {
    // some MultEQ-X files leave the key out on channels that never had a custom curve
    const raw = createSampleAdy();
    // @ts-expect-error removing the key as those files do
    delete raw.detectedChannels[0].customTargetCurvePoints;
    const parsed = parseAdy(JSON.stringify(raw));
    expect(parsed.detectedChannels[0].customTargetCurvePoints).toEqual([]);
  });

  it('rejects customTargetCurvePoints that is present but not an array', () => {
    const bad = createSampleAdy();
    // @ts-expect-error deliberately breaking the fixture for this test
    bad.detectedChannels[0].customTargetCurvePoints = 'nope';
    expect(() => parseAdy(JSON.stringify(bad))).toThrow(AdyValidationError);
  });

  it('rejects a missing enTargetCurveType', () => {
    const bad = createSampleAdy();
    // @ts-expect-error deliberately breaking the fixture for this test
    delete bad.enTargetCurveType;
    expect(() => parseAdy(JSON.stringify(bad))).toThrow(AdyValidationError);
  });
});

describe('isSubwooferChannel', () => {
  it('treats commandId starting with SW as a subwoofer', () => {
    const ady = createSampleAdy();
    expect(isSubwooferChannel(ady.detectedChannels[1])).toBe(true);
  });

  it('does not treat other commandIds as a subwoofer', () => {
    const ady = createSampleAdy();
    expect(isSubwooferChannel(ady.detectedChannels[0])).toBe(false);
  });
});

import { applyCurveToAdy, looksAlreadyProcessed, serializeAdy } from './ady';
import { computeTrimShift, designGain, frequencyGrid } from './curve';
import { testParams, tiltBands } from './fixtures/testParams';

describe('applyCurveToAdy', () => {
  const params = testParams({ bands: tiltBands(3) });

  it('writes the same customTargetCurvePoints to every channel', () => {
    const result = applyCurveToAdy(createSampleAdy(), params);
    expect(result.detectedChannels[0].customTargetCurvePoints).toEqual(
      result.detectedChannels[1].customTargetCurvePoints
    );
    expect(result.detectedChannels[0].customTargetCurvePoints.length).toBe(frequencyGrid().length);
  });

  it('adds the trim shift only to the subwoofer channel', () => {
    const result = applyCurveToAdy(createSampleAdy(), params);
    const trimShift = computeTrimShift(params);
    expect(parseFloat(result.detectedChannels[1].trimAdjustment)).toBeCloseTo(-1.25 + trimShift, 5);
    expect(result.detectedChannels[0].trimAdjustment).toBe('0.500000');
  });

  it('writes the selected rolloff type as enTargetCurveType', () => {
    expect(applyCurveToAdy(createSampleAdy(), params).enTargetCurveType).toBe(2);
    expect(applyCurveToAdy(createSampleAdy(), { ...params, rolloffType: 1 }).enTargetCurveType).toBe(1);
  });

  it('leaves the sub trimAdjustment exactly as it was when subTrim is off', () => {
    const result = applyCurveToAdy(createSampleAdy(), { ...params, subTrim: false });
    expect(result.detectedChannels[1].trimAdjustment).toBe('-1.250000');
    // the curves are still written to every channel
    expect(result.detectedChannels[1].customTargetCurvePoints).toHaveLength(frequencyGrid().length);
  });

  it('does not mutate the input', () => {
    const input = createSampleAdy();
    applyCurveToAdy(input, params);
    expect(input.detectedChannels[0].customTargetCurvePoints).toEqual([]);
    expect(input.enTargetCurveType).toBe(0);
  });

  it('preserves unrelated fields', () => {
    const result = applyCurveToAdy(createSampleAdy(), params);
    expect(result.detectedChannels[0].responseData).toEqual({ 0: [1, 2, 3] });
    expect(result.title).toBe('Sample');
  });

  it('writes the raw designed curve (no knee cancellation) when cancelRolloff is false', () => {
    const noCancel = { ...params, cancelRolloff: false };
    const result = applyCurveToAdy(createSampleAdy(), noCancel);
    const points = result.detectedChannels[0].customTargetCurvePoints;
    // 20kHz is where the knee is largest (-6.13dB), so cancelled vs raw differ most here
    expect(points[points.length - 1]).toBe(`{20000.0, ${designGain(20000, noCancel).toFixed(3)}}`);
  });
});

describe('serializeAdy', () => {
  it('round-trips through parseAdy', () => {
    const original = createSampleAdy();
    const text = serializeAdy(original);
    const reparsed = parseAdy(text);
    expect(reparsed).toEqual(original);
  });
});

describe('looksAlreadyProcessed', () => {
  it('is false for a raw file with no custom points', () => {
    expect(looksAlreadyProcessed(createSampleAdy())).toBe(false);
  });

  it('is true for a file this tool wrote', () => {
    const written = applyCurveToAdy(createSampleAdy(), testParams());
    expect(looksAlreadyProcessed(written)).toBe(true);
    expect(looksAlreadyProcessed(parseAdy(serializeAdy(written)))).toBe(true);
  });

  it('is false for custom points on some other grid', () => {
    const ady = createSampleAdy();
    ady.detectedChannels[0].customTargetCurvePoints = ['{20.0, 0.000}', '{1000.0, 0.000}', '{20000.0, 0.000}'];
    expect(looksAlreadyProcessed(ady)).toBe(false);
  });

  it('is false when the point count matches but a frequency does not', () => {
    const written = applyCurveToAdy(createSampleAdy(), testParams());
    written.detectedChannels[0].customTargetCurvePoints[500] = '{999.0, 0.000}';
    written.detectedChannels[1].customTargetCurvePoints = [];
    expect(looksAlreadyProcessed(written)).toBe(false);
  });
});

import { MeasuredCorrectionError, applyMeasuredCorrection } from './ady';
import type { TrimFn } from './curve';

describe('applyMeasuredCorrection', () => {
  /** FL, SW1 and FR, all carrying the default design on the write grid. */
  function designed() {
    const ady = applyCurveToAdy(createSampleAdy(), testParams());
    ady.detectedChannels.push({
      commandId: 'FR',
      customTargetCurvePoints: [...ady.detectedChannels[0].customTargetCurvePoints],
      trimAdjustment: '0.250000',
    });
    return ady;
  }
  const byId = (ady: ReturnType<typeof designed>, id: string) =>
    ady.detectedChannels.find((c) => c.commandId === id)!;
  const trim: TrimFn = (f) => (f >= 5000 ? -1.5 : 0);
  const gainOf = (point: string) => parseFloat(point.split(',')[1]);
  /** Same rounding as the writer, which prints a negative zero as "0.000". */
  const fmt = (gain: number) => (gain.toFixed(3) === '-0.000' ? '0.000' : gain.toFixed(3));

  it('adds the trim to each point of a channel on the write grid', () => {
    const input = designed();
    const result = applyMeasuredCorrection(input, input, new Map([['FL', trim]]), 3);
    const before = byId(input, 'FL').customTargetCurvePoints;
    const after = byId(result, 'FL').customTargetCurvePoints;
    const grid = frequencyGrid();
    expect(after).toHaveLength(grid.length);
    after.forEach((point, i) =>
      expect(point).toBe(`{${grid[i].toFixed(1)}, ${fmt(gainOf(before[i]) + trim(grid[i]))}}`)
    );
  });

  it('leaves untrimmed channels, the sub, every trimAdjustment and enTargetCurveType untouched', () => {
    const input = designed();
    input.enTargetCurveType = 1;
    const result = applyMeasuredCorrection(input, input, new Map([['FL', trim], ['SW1', trim]]), 3);
    expect(byId(result, 'FR')).toEqual(byId(input, 'FR'));
    expect(byId(result, 'SW1')).toEqual(byId(input, 'SW1'));
    expect(byId(result, 'FL').trimAdjustment).toBe(byId(input, 'FL').trimAdjustment);
    expect(result.enTargetCurveType).toBe(1);
    expect(result.title).toBe('Sample');
  });

  it('resamples a curve that is not on the write grid onto it', () => {
    const ady = createSampleAdy();
    ady.detectedChannels[0].customTargetCurvePoints = ['{20.0, 2.000}', '{1000.0, 0.000}', '{20000.0, -2.000}'];
    const points = applyMeasuredCorrection(ady, ady, new Map([['FL', () => 0.5]]), 3).detectedChannels[0]
      .customTargetCurvePoints;
    expect(points).toHaveLength(frequencyGrid().length);
    expect(points[0]).toBe('{20.0, 2.500}');
    expect(points[points.length - 1]).toBe('{20000.0, -1.500}');
    // log-frequency interpolation between 20 Hz (2 dB) and 1 kHz (0 dB)
    const at200 = 2 - (2 * Math.log10(200 / 20)) / Math.log10(1000 / 20) + 0.5;
    expect(points.find((p) => p.startsWith('{200.0,'))).toBe(`{200.0, ${at200.toFixed(3)}}`);
  });

  it('refuses a trimmed channel that has no target curve', () => {
    const sample = createSampleAdy();
    const run = () => applyMeasuredCorrection(sample, sample, new Map([['FL', trim]]), 3);
    expect(run).toThrow(MeasuredCorrectionError);
    expect(run).toThrow(/FL has no target curve/);
  });

  it('ignores a trim for a channel the file does not have', () => {
    const input = designed();
    expect(applyMeasuredCorrection(input, input, new Map([['XX', trim]]), 3)).toEqual(input);
  });

  it('changes nothing on a pass with a zero trim', () => {
    const input = designed();
    expect(applyMeasuredCorrection(input, input, new Map([['FL', () => 0], ['FR', () => 0]]), 3)).toEqual(input);
  });

  it('does not mutate the input', () => {
    const input = designed();
    const snapshot = JSON.stringify(input);
    applyMeasuredCorrection(input, input, new Map([['FL', trim]]), 3);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  /** createSampleAdy() with every non-sub channel's curve at a constant `db` on the write grid. */
  function constant(db: number, title = 'Sample') {
    const ady = createSampleAdy();
    ady.title = title;
    ady.detectedChannels[0].customTargetCurvePoints = frequencyGrid().map((f) => `{${f.toFixed(1)}, ${db.toFixed(3)}}`);
    return ady;
  }
  const gainsOf = (ady: ReturnType<typeof constant>) => byId(ady, 'FL').customTargetCurvePoints.map(gainOf);

  it('adds the step to the correction already in the measured-with file', () => {
    const result = applyMeasuredCorrection(constant(0), constant(1), new Map([['FL', () => 0.5]]), 3);
    expect(gainsOf(result).every((g) => g === 1.5)).toBe(true);
  });

  it('caps the total distance from the target at the limit', () => {
    const up = applyMeasuredCorrection(constant(0), constant(2.5), new Map([['FL', () => 1]]), 3);
    expect(gainsOf(up).every((g) => g === 3)).toBe(true);
    const down = applyMeasuredCorrection(constant(0), constant(-2.5), new Map([['FL', () => -1]]), 3);
    expect(gainsOf(down).every((g) => g === -3)).toBe(true);
    const lowered = applyMeasuredCorrection(constant(0), constant(2.5), new Map([['FL', () => 0]]), 2);
    expect(gainsOf(lowered).every((g) => g === 2)).toBe(true);
  });

  it('measures the limit from the target, not from zero', () => {
    const result = applyMeasuredCorrection(constant(-4), constant(-2), new Map([['FL', () => 1]]), 3);
    expect(gainsOf(result).every((g) => g === -1)).toBe(true);
  });

  it('edits a copy of the measured-with file, keeping its other fields', () => {
    const target = constant(0, 'Target');
    const withFile = constant(1, 'Round 1');
    byId(withFile, 'SW1').trimAdjustment = '2.000000';
    const result = applyMeasuredCorrection(target, withFile, new Map([['FL', () => 0]]), 3);
    expect(result.title).toBe('Round 1');
    expect(byId(result, 'SW1')).toEqual(byId(withFile, 'SW1'));
  });

  it('refuses a corrected speaker with no curve in the target or in the measured-with file', () => {
    const noTarget = () => applyMeasuredCorrection(createSampleAdy(), constant(0), new Map([['FL', trim]]), 3);
    expect(noTarget).toThrow(/FL has no target curve/);
    const noWith = () => applyMeasuredCorrection(constant(0), createSampleAdy(), new Map([['FL', trim]]), 3);
    expect(noWith).toThrow('Channel FL has no curve in the file you measured with.');
  });

  it('refuses a limit that is not a positive number', () => {
    const ady = constant(0);
    expect(() => applyMeasuredCorrection(ady, ady, new Map([['FL', trim]]), 0)).toThrow(/Limit/);
    expect(() => applyMeasuredCorrection(ady, ady, new Map([['FL', trim]]), NaN)).toThrow(/Limit/);
  });
});

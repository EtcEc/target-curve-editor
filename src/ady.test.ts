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

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

import { applyCurveToAdy, serializeAdy } from './ady';
import { computeTrimShift, frequencyGrid, type CurveParams } from './curve';

describe('applyCurveToAdy', () => {
  const params: CurveParams = { slope: 3, shelfEnabled: false, shelfGain: 0 };

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

  it('forces enTargetCurveType to 2', () => {
    const result = applyCurveToAdy(createSampleAdy(), params);
    expect(result.enTargetCurveType).toBe(2);
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
});

describe('serializeAdy', () => {
  it('round-trips through parseAdy', () => {
    const original = createSampleAdy();
    const text = serializeAdy(original);
    const reparsed = parseAdy(text);
    expect(reparsed).toEqual(original);
  });
});

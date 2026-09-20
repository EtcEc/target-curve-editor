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

import { applyCurveToAdy, hasAppliedTrims, serializeAdy } from './ady';
import { computeTrimShift, designGain, frequencyGrid, writtenGain, type CurveParams, type TrimFn } from './curve';

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

  it('writes the raw designed curve (no knee cancellation) when cancelHfKnee is false', () => {
    const noCancel: CurveParams = { ...params, cancelHfKnee: false };
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

describe('applyCurveToAdy with per-channel trims', () => {
  const params: CurveParams = { slope: 0.7, shelfEnabled: false, shelfGain: 0 };
  const trim: TrimFn = (f) => (f >= 5000 ? -1.5 : 0);

  function threeChannelAdy() {
    const ady = createSampleAdy();
    ady.detectedChannels.push({ commandId: 'FR', customTargetCurvePoints: [], trimAdjustment: '0.000000' });
    return ady;
  }
  const pointsOf = (ady: ReturnType<typeof threeChannelAdy>, id: string) =>
    ady.detectedChannels.find((c) => c.commandId === id)!.customTargetCurvePoints;

  it('is identical to the untrimmed output when the trims map is empty', () => {
    expect(applyCurveToAdy(threeChannelAdy(), params, new Map())).toEqual(
      applyCurveToAdy(threeChannelAdy(), params)
    );
  });

  it('adds the trim only to the channel that has one', () => {
    const result = applyCurveToAdy(threeChannelAdy(), params, new Map([['FL', trim]]));
    const fl = pointsOf(result, 'FL');
    const fr = pointsOf(result, 'FR');
    expect(fl[fl.length - 1]).toBe(`{20000.0, ${(writtenGain(20000, params) - 1.5).toFixed(3)}}`);
    expect(fr[fr.length - 1]).toBe(`{20000.0, ${writtenGain(20000, params).toFixed(3)}}`);
    // below the trim's own onset the two channels are identical
    expect(fl[0]).toBe(fr[0]);
    expect(fl).toHaveLength(frequencyGrid().length);
  });

  it('never trims a subwoofer, even if the map names it', () => {
    const plain = applyCurveToAdy(threeChannelAdy(), params);
    const result = applyCurveToAdy(threeChannelAdy(), params, new Map([['SW1', trim]]));
    expect(pointsOf(result, 'SW1')).toEqual(pointsOf(plain, 'SW1'));
  });

  it('leaves the subwoofer trim shift untouched', () => {
    const plain = applyCurveToAdy(threeChannelAdy(), params);
    const result = applyCurveToAdy(threeChannelAdy(), params, new Map([['FL', trim]]));
    const sw = (a: typeof plain) => a.detectedChannels.find((c) => c.commandId === 'SW1')!.trimAdjustment;
    expect(sw(result)).toBe(sw(plain));
  });

  it('does not mutate the input', () => {
    const input = threeChannelAdy();
    applyCurveToAdy(input, params, new Map([['FL', trim]]));
    expect(pointsOf(input, 'FL')).toEqual([]);
  });
});

describe('hasAppliedTrims', () => {
  const ady = createSampleAdy(); // FL and SW1
  const trim: TrimFn = () => 0;

  it('is false when there are no trims', () => {
    expect(hasAppliedTrims(ady, undefined)).toBe(false);
    expect(hasAppliedTrims(ady, new Map())).toBe(false);
  });

  it('is true when a non-sub channel of the file has a trim', () => {
    expect(hasAppliedTrims(ady, new Map([['FL', trim]]))).toBe(true);
  });

  it('is false when only the subwoofer or unknown channels have trims', () => {
    expect(hasAppliedTrims(ady, new Map([['SW1', trim]]))).toBe(false);
    expect(hasAppliedTrims(ady, new Map([['XX', trim]]))).toBe(false);
  });
});

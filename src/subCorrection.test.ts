import { describe, expect, it } from 'vitest';
import type { AdyFile } from './ady';
import type { Correction } from './correction';
import { createSampleAdy } from './fixtures/sampleAdy';
import { logGrid } from './measuredError';
import {
  DEFAULT_CROSSOVER_HZ,
  buildSubCorrections,
  commonError,
  crossoverHz,
  subBandWeight,
  subStep,
  summarizeSubs,
} from './subCorrection';

const grid = logGrid();
const curve = (fn: (f: number) => number) => grid.map((f) => `{${f.toFixed(3)}, ${fn(f).toFixed(3)}}`);
const zeros = grid.map(() => 0);
/** 2 dB below 60 Hz, 0 above: 0 around the 1 kHz pin. */
const bassBump = grid.map((f) => (f < 60 ? 2 : 0));

/** FL, FR and SW1, all with a flat curve; FL and FR crossed over at 80 Hz. */
function ady(): AdyFile {
  const a = createSampleAdy();
  a.enTargetCurveType = 2;
  a.detectedChannels[0].customTargetCurvePoints = curve(() => 0);
  a.detectedChannels[0].customCrossover = '80';
  a.detectedChannels[1].customTargetCurvePoints = curve(() => 0);
  a.detectedChannels.push({ commandId: 'FR', customTargetCurvePoints: curve(() => 0), trimAdjustment: '0.000000', customCrossover: '80' });
  return a;
}

describe('crossoverHz', () => {
  it('takes the highest crossover among the corrected speakers', () => {
    const a = ady();
    a.detectedChannels[2].customCrossover = '120';
    expect(crossoverHz(a, ['FL', 'FR'])).toBe(120);
    expect(crossoverHz(a, ['FL'])).toBe(80);
  });

  it('falls back to 80 Hz when no corrected speaker has a usable value', () => {
    const a = ady();
    delete a.detectedChannels[0].customCrossover;
    a.detectedChannels[2].customCrossover = 'N/A';
    expect(crossoverHz(a, ['FL', 'FR'])).toBe(DEFAULT_CROSSOVER_HZ);
    expect(DEFAULT_CROSSOVER_HZ).toBe(80);
  });
});

describe('subBandWeight', () => {
  it('is full below 2X/√2, half at 2X and zero above 2X·√2', () => {
    expect(subBandWeight(40, 80)).toBe(1);
    expect(subBandWeight(160 / Math.SQRT2, 80)).toBeCloseTo(1, 9);
    expect(subBandWeight(160, 80)).toBeCloseTo(0.5, 9);
    expect(subBandWeight(160 * Math.SQRT2, 80)).toBeCloseTo(0, 9);
    expect(subBandWeight(1000, 80)).toBe(0);
  });
});

describe('commonError', () => {
  it('is the mean of the speakers\' errors', () => {
    const correction: Correction = {
      FL: { positions: 3, error: grid.map(() => 1), soFar: zeros },
      FR: { positions: 3, error: grid.map(() => 3), soFar: zeros },
    };
    expect(commonError(correction).every((v) => v === 2)).toBe(true);
  });

  it('is the one speaker\'s error when only one was measured', () => {
    expect(commonError({ FL: { positions: 1, error: bassBump, soFar: zeros } })).toEqual(bassBump);
  });
});

describe('buildSubCorrections', () => {
  const correction: Correction = {
    FL: { positions: 3, error: bassBump, soFar: zeros },
    FR: { positions: 3, error: grid.map((f, i) => bassBump[i] + (f > 200 && f < 400 ? -2 : 0)), soFar: zeros },
  };

  it('gives each sub the speakers\' common error, the crossover and the correction so far', () => {
    const target = ady();
    const withFile = ady();
    withFile.detectedChannels[1].customTargetCurvePoints = curve((f) => (f < 100 ? 1 : 0));
    const [sub, ...rest] = buildSubCorrections(target, withFile, correction);
    expect(rest).toEqual([]);
    expect(sub.commandId).toBe('SW1');
    expect(sub.fromSpeakers).toBe(2);
    expect(sub.crossoverHz).toBe(80);
    expect(sub.error).toEqual(commonError(correction));
    expect(sub.soFar[grid.findIndex((f) => f >= 40)]).toBeCloseTo(1, 6);
    expect(sub.soFar[grid.findIndex((f) => f >= 1000)]).toBeCloseTo(0, 6);
  });

  it('skips a sub without a curve in either file, and needs a measured speaker', () => {
    const noCurve = ady();
    noCurve.detectedChannels[1].customTargetCurvePoints = [];
    expect(buildSubCorrections(noCurve, ady(), correction)).toEqual([]);
    expect(buildSubCorrections(ady(), noCurve, correction)).toEqual([]);
    expect(buildSubCorrections(ady(), ady(), {})).toEqual([]);
  });
});

describe('subStep', () => {
  const [sub] = buildSubCorrections(ady(), ady(), { FL: { positions: 1, error: bassBump, soFar: zeros } });

  it('corrects the common error below the band edge and nothing above it', () => {
    const step = subStep(sub, 0);
    expect(step(30)).toBeCloseTo(-2, 6);
    expect(step(300)).toBeCloseTo(0, 9);
  });

  it('follows the cutoff, strength and limit', () => {
    expect(subStep(sub, 500)(30)).toBeCloseTo(0, 6);
    expect(subStep(sub, 0, { detailOctaves: 1, strength: 0.5, limitDb: 3 })(30)).toBeCloseTo(-1, 6);
    expect(subStep(sub, 0, { detailOctaves: 1, strength: 1, limitDb: 1 })(30)).toBeCloseTo(-1, 6);
  });
});

describe('summarizeSubs', () => {
  it('reports the speakers the sub is based on and its largest change', () => {
    const [sub] = buildSubCorrections(ady(), ady(), { FL: { positions: 4, error: bassBump, soFar: zeros } });
    const [row] = summarizeSubs([sub], 0);
    expect(row.commandId).toBe('SW1');
    expect(row.positions).toBe(1);
    expect(row.maxThisRound).toBeCloseTo(2, 6);
    expect(row.maxTotal).toBeCloseTo(2, 6);
  });
});

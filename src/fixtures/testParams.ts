import type { Band } from '../bands';
import type { CurveParams } from '../curve';
import { DEFAULT_PRESET_NAME, presetBands } from '../presets';

/** Default design (the "Current (approximated)" preset), Roll Off 2, cancel on, sub trim on. */
export function testParams(overrides: Partial<CurveParams> = {}): CurveParams {
  return {
    bands: presetBands(DEFAULT_PRESET_NAME),
    rolloffType: 2,
    cancelRolloff: true,
    subTrim: true,
    ...overrides,
  };
}

/** A single unlimited tilt band, for tests that want a simple known curve. */
export function tiltBands(slope: number): Band[] {
  return [{ type: 'tilt', enabled: true, slope, pivot: 1000, fLow: 20, fHigh: 20000 }];
}

import { describe, it, expect } from 'vitest';
import { hfKneeGain } from './hfKnee';

describe('hfKneeGain', () => {
  it('is exactly 0dB at the first extracted point (20Hz)', () => {
    expect(hfKneeGain(20)).toBeCloseTo(0, 6);
  });

  it('is 0dB well below the knee (100Hz)', () => {
    expect(hfKneeGain(100)).toBeCloseTo(0, 4);
  });

  it('is 0dB at 1kHz (flat midrange)', () => {
    expect(hfKneeGain(1000)).toBeCloseTo(0, 4);
  });

  it('is -0.5772dB at 5kHz', () => {
    expect(hfKneeGain(5000)).toBeCloseTo(-0.5772, 4);
  });

  it('is -3.4632dB at 10kHz', () => {
    expect(hfKneeGain(10000)).toBeCloseTo(-3.4632, 4);
  });

  it('is exactly -6.1328dB at the last extracted point (20kHz)', () => {
    expect(hfKneeGain(20000)).toBeCloseTo(-6.1328, 4);
  });

  it('clamps to the first extracted value below 20Hz', () => {
    expect(hfKneeGain(10)).toBeCloseTo(0, 6);
  });

  it('clamps to the last extracted value above 20kHz', () => {
    expect(hfKneeGain(30000)).toBeCloseTo(-6.1328, 4);
  });

  it('interpolates monotonically between two adjacent extracted points', () => {
    // sanity check: gain should move smoothly, not jump, between neighboring
    // points once inside the knee region
    const a = hfKneeGain(9990);
    const mid = hfKneeGain(9995);
    const b = hfKneeGain(10000);
    expect(mid).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-6);
    expect(mid).toBeLessThanOrEqual(Math.max(a, b) + 1e-6);
  });
});

import { describe, it, expect } from 'vitest';
import { hfKneeGain } from './hfKnee';

describe('hfKneeGain', () => {
  it('is ~0dB well below the knee (100Hz)', () => {
    expect(hfKneeGain(100)).toBeCloseTo(0, 3);
  });

  it('is ~0dB at 1kHz (flat midrange)', () => {
    expect(hfKneeGain(1000)).toBeCloseTo(0, 3);
  });

  it('is ~-0.591dB at 5kHz', () => {
    expect(hfKneeGain(5000)).toBeCloseTo(-0.5915, 3);
  });

  it('is ~-3.416dB at 10kHz', () => {
    expect(hfKneeGain(10000)).toBeCloseTo(-3.4156, 3);
  });

  it('is ~-5.944dB at 20kHz', () => {
    expect(hfKneeGain(20000)).toBeCloseTo(-5.9444, 3);
  });
});

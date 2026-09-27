import type { AdyChannel } from './ady';

/** Thrown when a channel's customTargetCurvePoints can't be read. */
export class TargetParseError extends Error {}

const POINT_PATTERN = /^\{\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\}$/;

/**
 * A channel's written curve as ascending frequencies (Hz) and their gains (dB).
 * Both are empty when the channel has no custom points.
 */
export function readCurvePoints(channel: AdyChannel): { freqs: number[]; gains: number[] } {
  const points = channel.customTargetCurvePoints.map((raw) => {
    const match = POINT_PATTERN.exec(String(raw).trim());
    const freq = match ? Number(match[1]) : NaN;
    const gain = match ? Number(match[2]) : NaN;
    if (!Number.isFinite(freq) || !Number.isFinite(gain) || freq <= 0) {
      throw new TargetParseError(`Channel ${channel.commandId}: cannot read curve point "${String(raw)}"`);
    }
    return { freq, gain };
  });
  points.sort((a, b) => a.freq - b.freq);
  return { freqs: points.map((p) => p.freq), gains: points.map((p) => p.gain) };
}

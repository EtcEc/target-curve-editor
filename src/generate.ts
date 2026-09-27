import { isSubwooferChannel, type AdyFile } from './ady';
import type { ChannelCorrection, Correction } from './correction';
import { computeError, rmsOver } from './measuredError';
import { parseRewText } from './rewParse';
import { ROLLOFF_TYPES, isRolloffType, type RolloffType } from './rolloff';

/** RMS error (dB, 2-20 kHz) above which a speaker gets a warning. */
const RMS_WARNING_DB = 4;

export class GenerateError extends Error {}

/**
 * The HF rolloff type the measured .ady was made with. Only types 1 and 2 have
 * a known shape, so anything else is refused.
 */
export function checkMeasuredType(ady: AdyFile): RolloffType {
  const type = ady.enTargetCurveType;
  if (!isRolloffType(type)) {
    throw new GenerateError(
      `That .ady has enTargetCurveType ${type}; this tool supports ${ROLLOFF_TYPES.join(' and ')} ` +
        `(High Frequency Roll Off ${ROLLOFF_TYPES.join(' and ')}).`
    );
  }
  return type;
}

export interface SpeakerInput {
  commandId: string;
  files: { name: string; text: string }[];
}

export interface ChannelReport {
  commandId: string;
  positions: number;
  /** RMS of the error curve over 2-20 kHz, in dB. */
  rmsError: number;
}

export interface MeasuredResult {
  correction: Correction;
  reports: ChannelReport[];
  warnings: string[];
}

/**
 * Measures each speaker's error from REW exports against the curve in `ady`,
 * the .ady that was loaded on the AVR for the sweeps (it supplies each
 * channel's target and the HF rolloff type). Speakers with no files are
 * skipped; a speaker's channel must already carry a custom target curve.
 */
export function measureCorrection(ady: AdyFile, speakers: readonly SpeakerInput[]): MeasuredResult {
  const rolloffType = checkMeasuredType(ady);
  const active = speakers.filter((s) => s.files.length > 0);
  if (active.length === 0) throw new GenerateError('No measurement files were given.');

  const correction: Correction = {};
  const reports: ChannelReport[] = [];
  const warnings: string[] = [];

  for (const speaker of active) {
    const channel = ady.detectedChannels.find((c) => c.commandId === speaker.commandId);
    if (!channel) throw new GenerateError(`The .ady has no channel ${speaker.commandId}.`);
    if (isSubwooferChannel(channel)) {
      throw new GenerateError(`Channel ${speaker.commandId} is a subwoofer and can't be corrected.`);
    }
    if (correction[speaker.commandId]) {
      throw new GenerateError(`Channel ${speaker.commandId} was given twice.`);
    }
    if (channel.customTargetCurvePoints.length === 0) {
      throw new GenerateError(
        `Channel ${speaker.commandId} has no target curve. Design one on the Design page first.`
      );
    }

    const measurements = speaker.files.map((f) => parseRewText(f.text, f.name));
    const error = computeError(measurements, channel, rolloffType);
    const rmsError = rmsOver(error, 2000, 20000);
    const entry: ChannelCorrection = { positions: measurements.length, error };

    correction[speaker.commandId] = entry;
    reports.push({ commandId: speaker.commandId, positions: measurements.length, rmsError });
    if (rmsError > RMS_WARNING_DB) {
      warnings.push(
        `${speaker.commandId}: error is ${rmsError.toFixed(1)} dB RMS over 2-20 kHz. Check that the right files are on this channel.`
      );
    }
  }

  return { correction, reports, warnings };
}

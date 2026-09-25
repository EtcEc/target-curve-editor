import { isSubwooferChannel, type AdyFile } from './ady';
import { createCorrection, type CorrectionChannel, type CorrectionFile } from './correction';
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

export interface GenerateResult {
  correction: CorrectionFile;
  reports: ChannelReport[];
  warnings: string[];
}

/**
 * Builds a correction file from REW exports. `measuredAdy` is the .ady the
 * measurements were made with (it supplies each channel's actual target).
 * Speakers with no files are skipped.
 */
export function generateCorrection(
  measuredAdy: AdyFile,
  speakers: readonly SpeakerInput[],
  label: string,
  now: Date = new Date()
): GenerateResult {
  const rolloffType = checkMeasuredType(measuredAdy);
  const active = speakers.filter((s) => s.files.length > 0);
  if (active.length === 0) throw new GenerateError('No measurement files were given.');

  const channels: Record<string, CorrectionChannel> = {};
  const reports: ChannelReport[] = [];
  const warnings: string[] = [];

  for (const speaker of active) {
    const channel = measuredAdy.detectedChannels.find((c) => c.commandId === speaker.commandId);
    if (!channel) throw new GenerateError(`The measured .ady has no channel ${speaker.commandId}.`);
    if (isSubwooferChannel(channel)) {
      throw new GenerateError(`Channel ${speaker.commandId} is a subwoofer and can't be corrected.`);
    }
    if (channels[speaker.commandId]) {
      throw new GenerateError(`Channel ${speaker.commandId} was given twice.`);
    }

    const measurements = speaker.files.map((f) => parseRewText(f.text, f.name));
    const error = computeError(measurements, channel, rolloffType);
    const rmsError = rmsOver(error, 2000, 20000);

    channels[speaker.commandId] = { positions: measurements.length, error };
    reports.push({ commandId: speaker.commandId, positions: measurements.length, rmsError });
    if (rmsError > RMS_WARNING_DB) {
      warnings.push(
        `${speaker.commandId}: error is ${rmsError.toFixed(1)} dB RMS over 2-20 kHz. Check that the right files are on this channel.`
      );
    }
  }

  return { correction: createCorrection(channels, label, now), reports, warnings };
}

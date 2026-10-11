import { isSubwooferChannel, type AdyFile } from './ady';
import type { ChannelCorrection, Correction } from './correction';
import { computeError, rmsOver, writtenCurve } from './measuredError';
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

function speakerIds(ady: AdyFile): Set<string> {
  return new Set(ady.detectedChannels.filter((c) => !isSubwooferChannel(c)).map((c) => c.commandId));
}

/**
 * Checks that the target file and the file the AVR was measured with belong
 * together: both of a supported, equal HF rolloff type and with the same
 * speakers (subs are ignored). Returns that rolloff type.
 */
export function checkFilePair(target: AdyFile, measuredWith: AdyFile): RolloffType {
  const type = checkMeasuredType(target);
  if (measuredWith === target) return type;
  const other = checkMeasuredType(measuredWith);
  if (other !== type) {
    throw new GenerateError(
      `The two files use different HF rolloff types (${type} and ${other}). Measure with a file made from this target.`
    );
  }
  const inTarget = speakerIds(target);
  const inOther = speakerIds(measuredWith);
  const onlyTarget = [...inTarget].filter((id) => !inOther.has(id));
  const onlyOther = [...inOther].filter((id) => !inTarget.has(id));
  if (onlyTarget.length > 0 || onlyOther.length > 0) {
    const parts: string[] = [];
    if (onlyTarget.length > 0) parts.push(`only in the target: ${onlyTarget.join(', ')}`);
    if (onlyOther.length > 0) parts.push(`only in the measured-with file: ${onlyOther.join(', ')}`);
    throw new GenerateError(`The two files have different speakers (${parts.join('; ')}).`);
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
 * Measures each speaker's error from REW exports against the target file's
 * curve (with the HF rolloff on top), and records the correction already in
 * place: the curve in `measuredWith`, the file that was on the AVR for the
 * sweeps, minus the target's. In round 1 both are the same file. Speakers with
 * no files are skipped; a corrected speaker needs a curve in both files.
 */
export function measureCorrection(
  target: AdyFile,
  measuredWith: AdyFile,
  speakers: readonly SpeakerInput[]
): MeasuredResult {
  const rolloffType = checkFilePair(target, measuredWith);
  const active = speakers.filter((s) => s.files.length > 0);
  if (active.length === 0) throw new GenerateError('No measurement files were given.');

  const correction: Correction = {};
  const reports: ChannelReport[] = [];
  const warnings: string[] = [];

  for (const speaker of active) {
    const channel = target.detectedChannels.find((c) => c.commandId === speaker.commandId);
    if (!channel) throw new GenerateError(`The target file has no channel ${speaker.commandId}.`);
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
    const withChannel = measuredWith.detectedChannels.find((c) => c.commandId === speaker.commandId);
    if (!withChannel || withChannel.customTargetCurvePoints.length === 0) {
      throw new GenerateError(`Channel ${speaker.commandId} has no curve in the file you measured with.`);
    }

    const measurements = speaker.files.map((f) => parseRewText(f.text, f.name));
    const error = computeError(measurements, channel, rolloffType);
    const targetCurve = writtenCurve(channel);
    const withCurve = writtenCurve(withChannel);
    const soFar = withCurve.map((v, i) => v - targetCurve[i]);
    const rmsError = rmsOver(error, 2000, 20000);
    const entry: ChannelCorrection = { positions: measurements.length, error, soFar };

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

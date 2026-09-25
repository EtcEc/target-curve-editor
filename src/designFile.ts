import { validateBands, type Band } from './bands';

/** A shareable design: the band list and whether the HF rolloff is cancelled. The rolloff type comes from the .ady. */
export interface DesignFile {
  version: 1;
  name: string;
  bands: Band[];
  cancelRolloff: boolean;
}

export class DesignFileError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Copies only the known fields of a band, or returns a message describing what is wrong with it. */
function parseBand(raw: unknown, index: number): Band {
  const where = `Band ${index + 1}`;
  if (!isObject(raw)) throw new DesignFileError(`${where} is not an object.`);
  if (typeof raw.enabled !== 'boolean') throw new DesignFileError(`${where}: "enabled" must be true or false.`);
  const num = (key: string): number => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new DesignFileError(`${where}: "${key}" must be a number.`);
    }
    return value;
  };
  switch (raw.type) {
    case 'tilt':
      return {
        type: 'tilt',
        enabled: raw.enabled,
        slope: num('slope'),
        pivot: num('pivot'),
        fLow: num('fLow'),
        fHigh: num('fHigh'),
      };
    case 'lowShelf':
    case 'highShelf':
    case 'bell':
      return { type: raw.type, enabled: raw.enabled, gain: num('gain'), freq: num('freq'), q: num('q') };
    default:
      throw new DesignFileError(`${where}: unknown band type ${JSON.stringify(raw.type)}.`);
  }
}

export function serializeDesign(name: string, bands: readonly Band[], cancelRolloff: boolean): string {
  const file: DesignFile = { version: 1, name, bands: [...bands], cancelRolloff };
  return JSON.stringify(file, null, 2);
}

/** Parses and validates a design file. Throws DesignFileError with the reason; a bad file never half-applies. */
export function parseDesign(text: string): DesignFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new DesignFileError(`Not valid JSON: ${(err as Error).message}`);
  }
  if (!isObject(raw)) throw new DesignFileError('Top level of the file is not an object.');
  if (raw.version !== 1) throw new DesignFileError(`Unsupported design file version: ${String(raw.version)}.`);
  if (!Array.isArray(raw.bands)) throw new DesignFileError('"bands" must be a list.');
  if (raw.cancelRolloff !== undefined && typeof raw.cancelRolloff !== 'boolean') {
    throw new DesignFileError('"cancelRolloff" must be true or false.');
  }
  const bands = raw.bands.map(parseBand);
  const problem = validateBands(bands);
  if (problem !== null) throw new DesignFileError(problem);
  return {
    version: 1,
    name: typeof raw.name === 'string' ? raw.name : '',
    bands,
    cancelRolloff: raw.cancelRolloff ?? true,
  };
}

/** A safe download name for a design, e.g. "design_My-Target.json". */
export function designFilename(name: string): string {
  const safe = name
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return safe === '' ? 'design.json' : `design_${safe}.json`;
}

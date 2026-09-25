import type { Band } from './bands';

export interface Preset {
  name: string;
  description: string;
  bands: Band[];
}

export const DEFAULT_PRESET_NAME = 'Current (approximated)';

export const PRESETS: readonly Preset[] = [
  {
    name: 'Flat',
    description: 'No bands: 0 dB everywhere.',
    bands: [],
  },
  {
    name: DEFAULT_PRESET_NAME,
    description:
      'The setup this tool used before bands existed (0.7 dB/oct tilt, 4.5 dB bass shelf), ' +
      'expressed with standard filters. Within 0.075 dB of the original shape.',
    bands: [
      { type: 'tilt', enabled: true, slope: 0.7, pivot: 1000, fLow: 50, fHigh: 20000 },
      { type: 'lowShelf', enabled: true, gain: 1.43, freq: 66.5, q: 0.9 },
    ],
  },
];

/** A deep copy of the named preset's bands, safe to edit. */
export function presetBands(name: string): Band[] {
  const preset = PRESETS.find((p) => p.name === name);
  if (!preset) throw new Error(`Unknown preset "${name}"`);
  return JSON.parse(JSON.stringify(preset.bands)) as Band[];
}

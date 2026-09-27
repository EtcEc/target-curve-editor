import type { Band } from './bands';

export interface Preset {
  name: string;
  description: string;
  bands: Band[];
}

export const DEFAULT_PRESET_NAME = 'Current (approximated)';

/** Both literature presets below are fitted from CSVs posted in this ASR forum thread. */
const ASR_TARGETS_THREAD =
  'https://www.audiosciencereview.com/forum/index.php?threads/a-collection-of-speaker-target-responses-in-csv-txt-format.16401/';

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
  {
    name: 'Harman (approximate)',
    description:
      `Approximate: the Harman in-room speaker target, fitted from a CSV posted at ${ASR_TARGETS_THREAD}. ` +
      'Within 0.15 dB of that curve. A stronger, wider bass shelf and treble tilt than the default preset.',
    bands: [
      { type: 'tilt', enabled: true, slope: 0.48, pivot: 250, fLow: 450, fHigh: 20000 },
      { type: 'lowShelf', enabled: true, gain: 6.63, freq: 105, q: 0.78 },
    ],
  },
  {
    name: 'Toole (approximate)',
    description:
      `Approximate: an in-room speaker target attributed to Floyd Toole, fitted from a CSV posted at ${ASR_TARGETS_THREAD}. ` +
      'Within 0.2 dB of that curve. A subtler bass shelf and treble tilt than the default preset.',
    bands: [
      { type: 'tilt', enabled: true, slope: 0.19, pivot: 3880, fLow: 92, fHigh: 20000 },
      { type: 'lowShelf', enabled: true, gain: 2.62, freq: 302, q: 0.38 },
    ],
  },
];

/** A deep copy of the named preset's bands, safe to edit. */
export function presetBands(name: string): Band[] {
  const preset = PRESETS.find((p) => p.name === name);
  if (!preset) throw new Error(`Unknown preset "${name}"`);
  return JSON.parse(JSON.stringify(preset.bands)) as Band[];
}

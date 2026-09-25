import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { validateBands, type Band } from './bands';
import { attachHandles } from './chartHandles';
import { resultGain, type CurveParams } from './curve';
import { SLOT_COLORS, SLOT_IDS } from './slots';

/** Log-spaced sample points for a smooth chart line, independent of the .ady write grid. */
export function chartFrequencies(): number[] {
  const points = 400;
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const freqs: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    freqs.push(10 ** (minLog + t * (maxLog - minLog)));
  }
  return freqs;
}

/** [frequencies, gains] for the live preview chart: what the listener gets (design + any rolloff left on). */
export function resultCurveData(params: CurveParams): [number[], number[]] {
  const freqs = chartFrequencies();
  const gains = freqs.map((f) => resultGain(f, params));
  return [freqs, gains];
}

/**
 * Chart gains for a compare slot, drawn with the current rolloff settings so every
 * line on the chart means the same thing. Null for an empty or unusable slot.
 */
export function slotCurveData(bands: readonly Band[] | null, params: CurveParams): number[] | null {
  if (!bands || validateBands(bands) !== null) return null;
  const slotParams: CurveParams = { ...params, bands: [...bands] };
  return chartFrequencies().map((f) => resultGain(f, slotParams));
}

/** One entry per compare slot: its gains on the chart grid, or null when the slot is empty. */
export type SlotGains = readonly (number[] | null)[];

/** uPlot data: x, then one row per slot (nulls when empty), then the live target curve on top. */
function chartData(params: CurveParams, slots: SlotGains): uPlot.AlignedData {
  const [freqs, target] = resultCurveData(params);
  const empty = freqs.map(() => null);
  const rows = SLOT_IDS.map((_, i) => slots[i] ?? empty);
  return [freqs, ...rows, target] as unknown as uPlot.AlignedData;
}

export interface ChartCallbacks {
  /** A handle drag changed `params.bands` in place; refresh everything that shows them. */
  onBandsDragged(): void;
}

export function createChart(container: HTMLElement, params: CurveParams, callbacks: ChartCallbacks): uPlot {
  let handles: ReturnType<typeof attachHandles> | null = null;
  const opts: uPlot.Options = {
    title: 'Target Curve',
    width: container.clientWidth || 800,
    height: 400,
    // the axes are fixed and the handles use the mouse, so a drag must not zoom
    cursor: { drag: { x: false, y: false } },
    scales: {
      x: { time: false, distr: 3, range: [20, 20000] },
      y: { range: [-15, 15] },
    },
    axes: [
      { label: 'Frequency (Hz)', stroke: '#ccc', grid: { stroke: '#333' } },
      { label: 'Gain (dB)', stroke: '#ccc', grid: { stroke: '#333' } },
    ],
    series: [
      {},
      ...SLOT_IDS.map((id) => ({ label: id, stroke: SLOT_COLORS[id], width: 1.5, show: false })),
      { label: 'Target Curve', stroke: '#e33', width: 2 },
    ],
    hooks: {
      ready: [
        (u) => {
          handles = attachHandles(u, params, callbacks.onBandsDragged);
          handles.update();
        },
      ],
      draw: [() => handles?.update()],
    },
  };
  const chart = new uPlot(opts, chartData(params, []), container);
  return chart;
}

export function updateChart(chart: uPlot, params: CurveParams, slots: SlotGains = []): void {
  // a slot's line and legend entry only show while the slot holds a design
  SLOT_IDS.forEach((_, i) => {
    const show = slots[i] != null;
    if (chart.series[i + 1].show !== show) chart.setSeries(i + 1, { show });
  });
  chart.setData(chartData(params, slots));
}

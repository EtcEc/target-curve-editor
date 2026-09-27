import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { baseChartOptions, fitChart } from '../chart';
import type { PreviewCurves } from '../correctionPreview';
import { logGrid } from '../measuredError';

function emptyData(): uPlot.AlignedData {
  const freq = logGrid();
  const empty = freq.map(() => null);
  return [freq, empty, empty, empty] as unknown as uPlot.AlignedData;
}

/** The Correct page chart: the current target, the measurement and the corrected target for one channel. */
export function createPreviewChart(container: HTMLElement): uPlot {
  const opts: uPlot.Options = {
    ...baseChartOptions(),
    width: container.clientWidth || 800,
    height: 420,
    series: [
      {},
      { label: 'Current target', stroke: '#9aa0ad', width: 1.5 },
      { label: 'Measured', stroke: 'rgba(245, 194, 107, 0.9)', width: 1 },
      { label: 'Corrected target', stroke: '#5b6cff', width: 2 },
    ],
  };
  const chart = new uPlot(opts, emptyData(), container);
  fitChart(chart, container);
  return chart;
}

export function updatePreviewChart(chart: uPlot, curves: PreviewCurves | null): void {
  chart.setData(
    curves
      ? ([curves.freq, curves.current, curves.measured, curves.corrected] as unknown as uPlot.AlignedData)
      : emptyData()
  );
}

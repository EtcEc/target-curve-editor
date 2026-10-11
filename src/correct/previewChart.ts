import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { baseChartOptions, chartHeight, fitChart } from '../chart';
import type { PreviewCurves } from '../correctionPreview';
import { logGrid } from '../measuredError';

/** Index of the "Measured with" series (only shown from round 2 on). */
const MEASURED_WITH = 3;

function emptyData(): uPlot.AlignedData {
  const freq = logGrid();
  const empty = freq.map(() => null);
  return [freq, empty, empty, empty, empty] as unknown as uPlot.AlignedData;
}

/** The Correct page chart: target, measurement, measured-with curve and new curve for one channel. */
export function createPreviewChart(container: HTMLElement): uPlot {
  const opts: uPlot.Options = {
    ...baseChartOptions(),
    width: container.clientWidth || 800,
    height: chartHeight(),
    series: [
      {},
      { label: 'Your target', stroke: '#9aa0ad', width: 1.5 },
      { label: 'Measured', stroke: 'rgba(245, 194, 107, 0.9)', width: 1 },
      { label: 'Measured with', stroke: 'rgba(154, 160, 173, 0.6)', width: 1, dash: [6, 4], show: false },
      { label: 'New curve', stroke: '#5b6cff', width: 2 },
    ],
  };
  const chart = new uPlot(opts, emptyData(), container);
  fitChart(chart, container);
  return chart;
}

export function updatePreviewChart(chart: uPlot, curves: PreviewCurves | null, showMeasuredWith: boolean): void {
  if (chart.series[MEASURED_WITH].show !== showMeasuredWith) chart.setSeries(MEASURED_WITH, { show: showMeasuredWith });
  chart.setData(
    curves
      ? ([curves.freq, curves.target, curves.measured, curves.measuredWith, curves.corrected] as unknown as uPlot.AlignedData)
      : emptyData()
  );
}

/** Index of the "Measured" series. */
const MEASURED = 2;

/** Renames the "Measured" line, e.g. to "Common to all speakers" while a sub is shown. */
export function setMeasuredLabel(chart: uPlot, text: string): void {
  const label = chart.root.querySelectorAll('.u-legend .u-series')[MEASURED]?.querySelector('.u-label');
  if (label && label.textContent !== text) label.textContent = text;
}

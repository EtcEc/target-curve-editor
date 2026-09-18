import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { designGain, type CurveParams } from './curve';

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

/** Transforms curve params into [frequencies, gains] for the live preview chart. */
export function designCurveData(params: CurveParams): [number[], number[]] {
  const freqs = chartFrequencies();
  const gains = freqs.map((f) => designGain(f, params));
  return [freqs, gains];
}

export function createChart(container: HTMLElement, params: CurveParams): uPlot {
  const opts: uPlot.Options = {
    title: 'Target Curve',
    width: container.clientWidth || 800,
    height: 400,
    scales: {
      x: { time: false, distr: 3, min: 20, max: 20000 },
      y: { range: [-30, 20] },
    },
    axes: [
      { label: 'Frequency (Hz)', stroke: '#ccc', grid: { stroke: '#333' } },
      { label: 'Gain (dB)', stroke: '#ccc', grid: { stroke: '#333' } },
    ],
    series: [{}, { label: 'Target Curve', stroke: '#e33', width: 2 }],
  };
  return new uPlot(opts, designCurveData(params) as uPlot.AlignedData, container);
}

export function updateChart(chart: uPlot, params: CurveParams): void {
  chart.setData(designCurveData(params) as uPlot.AlignedData);
}

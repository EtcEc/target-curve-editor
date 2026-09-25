import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { resultGain, type CurveParams } from './curve';

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

export function createChart(container: HTMLElement, params: CurveParams): uPlot {
  const opts: uPlot.Options = {
    title: 'Target Curve',
    width: container.clientWidth || 800,
    height: 400,
    scales: {
      x: { time: false, distr: 3, range: [20, 20000] },
      y: { range: [-15, 15] },
    },
    axes: [
      { label: 'Frequency (Hz)', stroke: '#ccc', grid: { stroke: '#333' } },
      { label: 'Gain (dB)', stroke: '#ccc', grid: { stroke: '#333' } },
    ],
    series: [{}, { label: 'Target Curve', stroke: '#e33', width: 2 }],
  };
  return new uPlot(opts, resultCurveData(params) as uPlot.AlignedData, container);
}

export function updateChart(chart: uPlot, params: CurveParams): void {
  chart.setData(resultCurveData(params) as uPlot.AlignedData);
}

import type uPlot from 'uplot';
import { BAND_LABELS, validateBands } from './bands';
import { chartOffset, type CurveParams } from './curve';
import { dragBand, handleFor, scaleQ } from './handles';

/**
 * Draggable handles for the shelf and bell bands, laid over the chart. Dragging
 * moves a band's frequency and gain (`params.bands` is edited in place); the
 * mouse wheel over a handle changes its Q. `update()` repositions the handles
 * from the current bands and is called after every draw.
 */
export function attachHandles(
  chart: uPlot,
  params: CurveParams,
  onChange: () => void
): { update(): void } {
  const layer = document.createElement('div');
  layer.className = 'handle-layer';
  chart.over.appendChild(layer);
  const nodes: HTMLElement[] = [];

  const offset = (f: number) => chartOffset(f, params);

  function makeNode(index: number): HTMLElement {
    const node = document.createElement('div');
    node.className = 'band-handle';
    node.dataset.band = String(index);
    // uPlot listens for mouse events on the overlay; the handle owns its own pointer
    node.addEventListener('mousedown', (e) => e.stopPropagation());
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || validateBands(params.bands) !== null) return;
      e.preventDefault();
      e.stopPropagation();
      node.setPointerCapture(e.pointerId);
      node.classList.add('dragging');
    });
    node.addEventListener('pointermove', (e) => {
      if (!node.hasPointerCapture(e.pointerId) || validateBands(params.bands) !== null) return;
      const band = params.bands[index];
      if (!band || band.type === 'tilt') return;
      const rect = chart.over.getBoundingClientRect();
      const freq = chart.posToVal(e.clientX - rect.left, 'x');
      const db = chart.posToVal(e.clientY - rect.top, 'y');
      const next = dragBand(params.bands, index, freq, db, offset);
      if (next.freq === band.freq && next.gain === band.gain) return;
      band.freq = next.freq;
      band.gain = next.gain;
      onChange();
    });
    // fires after pointerup, pointercancel and any other way the capture ends
    node.addEventListener('lostpointercapture', () => node.classList.remove('dragging'));
    node.addEventListener(
      'wheel',
      (e) => {
        const band = params.bands[index];
        if (!band || band.type === 'tilt' || validateBands(params.bands) !== null) return;
        e.preventDefault();
        band.q = Math.round(scaleQ(band.q, e.deltaY) * 100) / 100;
        onChange();
      },
      { passive: false }
    );
    layer.appendChild(node);
    return node;
  }

  function update(): void {
    const bands = params.bands;
    // while any band has unusable values the handles would edit garbage: hide them until it is fixed
    layer.hidden = validateBands(bands) !== null;
    if (layer.hidden) return;
    while (nodes.length > bands.length) nodes.pop()?.remove();
    while (nodes.length < bands.length) nodes.push(makeNode(nodes.length));
    bands.forEach((band, i) => {
      const node = nodes[i];
      const handle = handleFor(bands, i, offset);
      node.hidden = handle === null;
      if (handle === null || band.type === 'tilt') return;
      node.style.left = `${chart.valToPos(handle.freq, 'x')}px`;
      node.style.top = `${chart.valToPos(handle.y, 'y')}px`;
      node.title =
        `${i + 1}. ${BAND_LABELS[band.type]}: ${band.gain > 0 ? '+' : ''}${band.gain} dB at ${band.freq} Hz, Q ${band.q}` +
        ' (drag to move; scroll to change Q)';
    });
  }

  return { update };
}

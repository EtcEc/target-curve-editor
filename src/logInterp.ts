/**
 * Linear interpolation of `ys` against log10(`xs`), clamped to the end values
 * outside the range. `xs` must be ascending and positive.
 */
export function interpLogFreq(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0) throw new Error('interpLogFreq: no data points');
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (Math.log10(x) - Math.log10(xs[lo])) / (Math.log10(xs[hi]) - Math.log10(xs[lo]));
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

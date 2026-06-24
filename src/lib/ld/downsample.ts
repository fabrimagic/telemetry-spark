// Visual decimation: simple min/max bucket downsampling.
// Returns at most ~maxPoints {x, y} pairs without altering source data.

export interface XYPoint { x: number; y: number }

export function downsampleChannel(
  values: Float32Array,
  freq: number,
  maxPoints: number,
  xStart = 0,
): XYPoint[] {
  const n = values.length;
  if (n === 0) return [];
  if (n <= maxPoints) {
    const out: XYPoint[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = { x: xStart + i / freq, y: values[i] };
    return out;
  }
  const bucketSize = Math.ceil(n / (maxPoints / 2));
  const out: XYPoint[] = [];
  for (let i = 0; i < n; i += bucketSize) {
    let min = Infinity, max = -Infinity, minIdx = i, maxIdx = i;
    const end = Math.min(i + bucketSize, n);
    for (let j = i; j < end; j++) {
      const v = values[j];
      if (v < min) { min = v; minIdx = j; }
      if (v > max) { max = v; maxIdx = j; }
    }
    if (minIdx < maxIdx) {
      out.push({ x: xStart + minIdx / freq, y: min });
      out.push({ x: xStart + maxIdx / freq, y: max });
    } else {
      out.push({ x: xStart + maxIdx / freq, y: max });
      out.push({ x: xStart + minIdx / freq, y: min });
    }
  }
  return out;
}

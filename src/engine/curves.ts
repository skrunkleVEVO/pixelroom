import type { CurvePoint, EditParams } from './params';

export const LUT_SIZE = 1024;

/**
 * Builds an evaluator for a monotone cubic Hermite spline (Fritsch-Carlson)
 * through points sorted by x. Monotone tangents stop the curve overshooting
 * between control points, which would otherwise cause tonal inversions.
 * Coordinates are 0-255; x outside the point range holds the end values flat.
 */
export function createSpline(points: CurvePoint[]): (x: number) => number {
  const n = points.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => points[0][1];

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    secants.push((ys[i + 1] - ys[i]) / Math.max(xs[i + 1] - xs[i], 1e-6));
  }

  const tangents = new Array<number>(n);
  tangents[0] = secants[0];
  tangents[n - 1] = secants[n - 2];
  for (let i = 1; i < n - 1; i++) {
    tangents[i] = secants[i - 1] * secants[i] <= 0 ? 0 : (secants[i - 1] + secants[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (secants[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / secants[i];
    const b = tangents[i + 1] / secants[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      tangents[i] = t * a * secants[i];
      tangents[i + 1] = t * b * secants[i];
    }
  }

  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = Math.max(xs[i + 1] - xs[i], 1e-6);
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * tangents[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * tangents[i + 1]
    );
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Bakes the master and per-channel curves into one RGBA float LUT, composing
 * channel(master(x)) so the shader needs a single texture and three lookups.
 */
export function buildCurveLut(curve: EditParams['curve'], out?: Float32Array): Float32Array {
  const lut = out ?? new Float32Array(LUT_SIZE * 4);
  const master = createSpline(curve.rgb);
  const red = createSpline(curve.red);
  const green = createSpline(curve.green);
  const blue = createSpline(curve.blue);
  for (let i = 0; i < LUT_SIZE; i++) {
    const m = master((i / (LUT_SIZE - 1)) * 255);
    lut[i * 4] = clamp01(red(m) / 255);
    lut[i * 4 + 1] = clamp01(green(m) / 255);
    lut[i * 4 + 2] = clamp01(blue(m) / 255);
    lut[i * 4 + 3] = 1;
  }
  return lut;
}

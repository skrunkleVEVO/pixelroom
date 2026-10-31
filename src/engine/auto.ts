// White balance and Auto Tone calculations. These take plain pixel data so they can
// be tested without a GPU. The white balance gains here mirror Renderer.uploadUniforms.

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function whiteBalanceGains(temperature: number, tint: number): [number, number, number] {
  const temp = temperature / 100;
  const t = tint / 100;
  const r = (1 + 0.32 * temp) * (1 + 0.14 * t);
  const g = 1 - 0.28 * t;
  const b = (1 - 0.42 * temp) * (1 + 0.14 * t);
  const norm = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / norm, g / norm, b / norm];
}

/** Temperature and tint that turn this sRGB colour (0-255) neutral. */
export function neutralize(r: number, g: number, b: number): { temperature: number; tint: number } {
  const R = Math.max(srgbToLinear(r), 1e-4);
  const G = Math.max(srgbToLinear(g), 1e-4);
  const B = Math.max(srgbToLinear(b), 1e-4);
  const ratio = B / R;
  const temp = (ratio - 1) / (0.32 + 0.42 * ratio);
  const a = ((1 + 0.32 * temp) * R) / G;
  const tint = (1 - a) / (0.28 + 0.14 * a);
  return {
    temperature: Math.round(clamp(temp * 100, -100, 100)),
    tint: Math.round(clamp(tint * 100, -100, 100)),
  };
}

/** Gray-world white balance over RGBA pixels, ignoring clipped and near-black ones. */
export function autoWhiteBalance(data: Uint8ClampedArray | Uint8Array): { temperature: number; tint: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const hi = Math.max(data[i], data[i + 1], data[i + 2]);
    if (hi < 12 || hi > 250) continue;
    r += srgbToLinear(data[i]);
    g += srgbToLinear(data[i + 1]);
    b += srgbToLinear(data[i + 2]);
    n++;
  }
  if (!n) return { temperature: 0, tint: 0 };
  const toSrgb = (v: number) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return neutralize(toSrgb(r / n), toSrgb(g / n), toSrgb(b / n));
}

export interface AutoTone {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
}

/** Sets exposure from the median, then uses the tails to fill the tonal range. */
export function autoTone(data: Uint8ClampedArray | Uint8Array): AutoTone {
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++;
    total++;
  }
  const none: AutoTone = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
  if (!total) return none;
  const percentile = (p: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += histogram[v];
      if (seen >= total * p) return v;
    }
    return 255;
  };
  const p01 = percentile(0.01);
  const p50 = percentile(0.5);
  const p99 = percentile(0.99);
  const exposure = clamp(Math.log2(0.18 / Math.max(srgbToLinear(p50), 0.005)) * 0.6, -1.5, 1.5);
  const spread = p99 - p01;
  return {
    exposure: Math.round(exposure * 100) / 100,
    contrast: Math.round(clamp((170 - spread) * 0.2, -15, 25)),
    highlights: Math.round(clamp(-(p99 - 215) * 1.1, -60, 0)),
    shadows: Math.round(clamp((60 - p01) * 0.45, 0, 45)),
    whites: Math.round(clamp((245 - p99) * 0.7, -30, 40)),
    blacks: Math.round(clamp((10 - p01) * 1.5, -40, 25)),
  };
}

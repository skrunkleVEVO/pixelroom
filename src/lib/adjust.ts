// Adjustments, filters, and how the two combine into the "look" the shader draws.

export const ADJUSTMENTS = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'warmth', label: 'Warmth', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'fade', label: 'Fade', min: 0, max: 100 },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100 },
  { key: 'vignette', label: 'Vignette', min: -100, max: 100 },
  { key: 'grain', label: 'Grain', min: 0, max: 100 },
] as const;

export type AdjustKey = (typeof ADJUSTMENTS)[number]['key'];
export type Adjustments = Record<AdjustKey, number>;
export type Vec3 = [number, number, number];

export function neutralAdjustments(): Adjustments {
  const a = {} as Adjustments;
  for (const { key } of ADJUSTMENTS) a[key] = 0;
  return a;
}

export function adjustInfo(key: AdjustKey) {
  return ADJUSTMENTS.find((a) => a.key === key)!;
}

export interface Filter {
  id: string;
  name: string;
  adjust?: Partial<Adjustments>;
  /** 0..1 amount of black and white. */
  mono?: number;
  /** Colour added to the shadows and highlights, in 0..1 RGB offsets. */
  shadowTint?: Vec3;
  highlightTint?: Vec3;
}

export const FILTERS: Filter[] = [
  { id: 'none', name: 'Original' },
  { id: 'vivid', name: 'Vivid', adjust: { saturation: 22, vibrance: 30, contrast: 14 } },
  { id: 'punch', name: 'Punch', adjust: { contrast: 35, saturation: 15, shadows: -10, sharpen: 25 } },
  { id: 'warm', name: 'Warm', adjust: { warmth: 32, vibrance: 10, brightness: 5 } },
  {
    id: 'golden',
    name: 'Golden',
    adjust: { warmth: 38, highlights: -15, shadows: 15, saturation: 8 },
    highlightTint: [0.04, 0.02, -0.03],
  },
  { id: 'cool', name: 'Cool', adjust: { warmth: -30, tint: 5, contrast: 6 } },
  {
    id: 'cinema',
    name: 'Cinema',
    adjust: { contrast: 22, saturation: 8, vignette: 22 },
    shadowTint: [-0.03, 0.02, 0.05],
    highlightTint: [0.05, 0.02, -0.04],
  },
  {
    id: 'film',
    name: 'Film',
    adjust: { fade: 30, contrast: -8, saturation: -10, grain: 28 },
    shadowTint: [0, 0.02, 0.04],
    highlightTint: [0.03, 0.015, -0.02],
  },
  { id: 'matte', name: 'Matte', adjust: { fade: 45, contrast: -18, saturation: -15, brightness: 5 } },
  {
    id: 'dreamy',
    name: 'Dreamy',
    adjust: { brightness: 15, contrast: -20, highlights: -10, fade: 20, saturation: -5 },
    highlightTint: [0.02, 0, 0.03],
  },
  {
    id: 'moody',
    name: 'Moody',
    adjust: { brightness: -10, contrast: 20, saturation: -25, shadows: -15, vignette: 35, warmth: -10 },
    shadowTint: [0, 0.01, 0.03],
  },
  {
    id: 'vintage',
    name: 'Vintage',
    adjust: { fade: 35, warmth: 25, saturation: -30, contrast: -10, vignette: 30, grain: 30 },
    highlightTint: [0.03, 0.02, -0.02],
  },
  {
    id: 'pastel',
    name: 'Pastel',
    adjust: { brightness: 15, contrast: -25, saturation: -20, fade: 25 },
    shadowTint: [0.02, 0, 0.04],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    adjust: { warmth: 35, tint: 15, saturation: 15, highlights: -10 },
    highlightTint: [0.06, 0, -0.02],
  },
  { id: 'mono', name: 'Mono', mono: 1, adjust: { contrast: 10 } },
  { id: 'noir', name: 'Noir', mono: 1, adjust: { contrast: 45, shadows: -20, vignette: 40, grain: 20 } },
  {
    id: 'silver',
    name: 'Silver',
    mono: 1,
    adjust: { fade: 25, contrast: -10, brightness: 10 },
    shadowTint: [0, 0.01, 0.025],
  },
];

export function findFilter(id: string): Filter {
  return FILTERS.find((f) => f.id === id) ?? FILTERS[0];
}

/** Everything the renderer needs, in shader units (mostly -1..1). */
export interface Look {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  tint: number;
  highlights: number;
  shadows: number;
  vibrance: number;
  fade: number;
  sharpen: number;
  vignette: number;
  grain: number;
  mono: number;
  shadowTint: Vec3;
  highlightTint: Vec3;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The filter, scaled by strength (0..1), plus the user's own adjustments on top. */
export function resolveLook(filter: Filter, strength: number, adjust: Adjustments): Look {
  const look = { mono: (filter.mono ?? 0) * strength } as Look;
  for (const { key, min, max } of ADJUSTMENTS) {
    look[key] = clamp(adjust[key] + (filter.adjust?.[key] ?? 0) * strength, min, max) / 100;
  }
  const scale = (v?: Vec3): Vec3 => (v ? [v[0] * strength, v[1] * strength, v[2] * strength] : [0, 0, 0]);
  look.shadowTint = scale(filter.shadowTint);
  look.highlightTint = scale(filter.highlightTint);
  return look;
}

/** True when the shader pass would leave the pixels unchanged. */
export function isPixelNeutral(look: Look): boolean {
  const { vignette: _v, grain: _g, shadowTint, highlightTint, ...rest } = look;
  return (
    Object.values(rest).every((v) => v === 0) &&
    shadowTint.every((v) => v === 0) &&
    highlightTint.every((v) => v === 0)
  );
}

/**
 * One-tap enhance from a small RGBA sample: pulls average brightness toward the
 * middle, stretches a flat histogram, and removes an obvious colour cast.
 */
export function autoEnhance(rgba: Uint8ClampedArray): Partial<Adjustments> {
  const hist = new Uint32Array(256);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const l = Math.round(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]);
    hist[l]++;
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
    n++;
  }
  if (n === 0) return {};
  const percentile = (p: number) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= n * p) return i;
    }
    return 255;
  };
  const lo = percentile(0.02);
  const mid = percentile(0.5);
  const hi = percentile(0.98);
  const spread = Math.max(1, hi - lo);
  const round = (v: number) => Math.round(v);
  const contrast = clamp(round((200 / spread - 1) * 40), -10, 35);
  const brightness = clamp(round((118 - mid) * 0.6), -35, 40);
  const shadows = lo > 30 ? 0 : clamp(round((30 - lo) * 0.8), 0, 25);
  const highlights = hi < 235 ? 0 : -clamp(round((hi - 235) * 1.2), 0, 25);
  r /= n;
  g /= n;
  b /= n;
  const warmth = clamp(round(((b - r) / 255) * 120), -30, 30);
  const tint = clamp(round(((g - (r + b) / 2) / 255) * 120), -25, 25);
  return { brightness, contrast, shadows, highlights, warmth, tint, vibrance: 12 };
}

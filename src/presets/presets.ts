import {
  CURVE_CHANNELS,
  GRADE_ZONES,
  HSL_CHANNELS,
  RANGES,
  defaultParams,
  type CurvePoint,
  type EditParams,
  type Range,
} from '../engine/params';

export interface Preset {
  id: string;
  name: string;
  builtIn: boolean;
  params: EditParams;
}

export const NEUTRAL_ID = 'builtin-neutral';
export const MORIOH_ID = 'builtin-morioh';
/** Preset applied whenever a new photo is opened. */
export const DEFAULT_PRESET_ID = MORIOH_ID;

export function moriohParams(): EditParams {
  const base = defaultParams();
  return {
    ...base,
    light: { exposure: 0.2, contrast: 25, highlights: -35, shadows: 30, whites: 15, blacks: -10 },
    color: { temperature: 12, tint: -6, vibrance: 28, saturation: 8 },
    presence: { texture: 10, clarity: 15, dehaze: 8 },
    curve: {
      ...base.curve,
      rgb: [
        [0, 8],
        [64, 60],
        [128, 132],
        [192, 198],
        [255, 255],
      ],
      blue: [
        [0, 12],
        [128, 118],
        [255, 245],
      ],
    },
    hsl: {
      red: { hue: 10, sat: 20, lum: 0 },
      orange: { hue: -8, sat: 15, lum: 10 },
      yellow: { hue: -35, sat: 45, lum: 15 },
      green: { hue: -65, sat: -30, lum: 10 },
      aqua: { hue: -25, sat: 35, lum: 5 },
      blue: { hue: 25, sat: 40, lum: -10 },
      purple: { hue: 15, sat: 25, lum: 0 },
      magenta: { hue: 10, sat: 15, lum: 0 },
    },
    grading: {
      shadows: { hue: 270, sat: 18, lum: -5 },
      midtones: { hue: 45, sat: 10, lum: 0 },
      highlights: { hue: 55, sat: 22, lum: 5 },
      blending: 60,
      balance: 15,
    },
    effects: {
      vignetteAmount: -12,
      vignetteMidpoint: 50,
      vignetteFeather: 60,
      sharpening: 40,
      grain: 0,
    },
  };
}

export function builtInPresets(): Preset[] {
  return [
    { id: MORIOH_ID, name: 'Morioh', builtIn: true, params: moriohParams() },
    { id: NEUTRAL_ID, name: 'Neutral', builtIn: true, params: defaultParams() },
  ];
}

// ---------------------------------------------------------------- JSON format

const FORMAT = 'pixelroom-preset';
const VERSION = 1;

export function presetToJson(preset: Pick<Preset, 'name' | 'params'>): string {
  return JSON.stringify(
    { format: FORMAT, version: VERSION, name: preset.name, params: preset.params },
    null,
    2,
  );
}

type Loose = Record<string, unknown>;

function asObject(v: unknown): Loose {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {};
}

function num(v: unknown, fallback: number, [min, max]: Range): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function sanitizeCurve(v: unknown, fallback: CurvePoint[]): CurvePoint[] {
  if (!Array.isArray(v)) return fallback;
  const points: CurvePoint[] = [];
  for (const p of v) {
    // Accept both [x, y] and {x, y}.
    const x = Array.isArray(p) ? p[0] : asObject(p).x;
    const y = Array.isArray(p) ? p[1] : asObject(p).y;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([Math.min(255, Math.max(0, x)), Math.min(255, Math.max(0, y))]);
  }
  points.sort((a, b) => a[0] - b[0]);
  const unique = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0]);
  return unique.length >= 2 ? unique : fallback;
}

/**
 * Coerces untrusted JSON into valid parameters: missing or malformed values
 * fall back to neutral and numbers are clamped to their ranges, so a partial
 * or hand-edited preset can never put the shader into an invalid state.
 */
export function sanitizeParams(input: unknown): EditParams {
  const src = asObject(input);
  const out = defaultParams();

  const scalars = (group: 'light' | 'color' | 'presence' | 'effects') => {
    const from = asObject(src[group]);
    const to = out[group] as unknown as Record<string, number>;
    const ranges = RANGES[group] as unknown as Record<string, Range>;
    for (const key of Object.keys(to)) to[key] = num(from[key], to[key], ranges[key]);
  };
  scalars('light');
  scalars('color');
  scalars('presence');
  scalars('effects');

  const curve = asObject(src.curve);
  for (const ch of CURVE_CHANNELS) out.curve[ch] = sanitizeCurve(curve[ch], out.curve[ch]);

  const hsl = asObject(src.hsl);
  for (const ch of HSL_CHANNELS) {
    const v = asObject(hsl[ch]);
    out.hsl[ch] = {
      hue: num(v.hue, 0, RANGES.hsl.hue),
      sat: num(v.sat, 0, RANGES.hsl.sat),
      lum: num(v.lum, 0, RANGES.hsl.lum),
    };
  }

  const grading = asObject(src.grading);
  for (const zone of GRADE_ZONES) {
    const v = asObject(grading[zone]);
    out.grading[zone] = {
      hue: num(v.hue, 0, RANGES.grade.hue),
      sat: num(v.sat, 0, RANGES.grade.sat),
      lum: num(v.lum, 0, RANGES.grade.lum),
    };
  }
  out.grading.blending = num(grading.blending, 50, RANGES.grading.blending);
  out.grading.balance = num(grading.balance, 0, RANGES.grading.balance);

  return out;
}

/** Parses an exported preset file. Throws an Error with a readable message. */
export function presetFromJson(text: string): { name: string; params: EditParams } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const root = asObject(data);
  const params = asObject(root.params);
  const known = ['light', 'color', 'presence', 'curve', 'hsl', 'grading', 'effects'];
  if (!known.some((key) => key in params)) {
    throw new Error('That file does not contain PixelRoom preset settings.');
  }
  if (typeof root.version === 'number' && root.version > VERSION) {
    throw new Error('That preset was made by a newer version of PixelRoom.');
  }
  const name = typeof root.name === 'string' && root.name.trim() ? root.name.trim() : 'Imported';
  return { name: name.slice(0, 60), params: sanitizeParams(params) };
}

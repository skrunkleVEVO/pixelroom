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
import type { Geometry } from '../engine/geometry';

export interface Preset {
  id: string;
  name: string;
  builtIn: boolean;
  params: EditParams;
}

export const NEUTRAL_ID = 'builtin-neutral';
export const MORIOH_ID = 'builtin-morioh';
export const CYBERPUNK_ID = 'builtin-cyberpunk-edgerunners';
export const TOKYO_GHOUL_ID = 'builtin-tokyo-ghoul';
/** Photos open unedited. A look is something you choose, never something done to you. */
export const DEFAULT_PRESET_ID = NEUTRAL_ID;

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
      ...base.effects,
      vignetteAmount: -12,
      vignetteMidpoint: 50,
      vignetteFeather: 60,
      sharpening: 40,
      grain: 0,
    },
  };
}

export function cyberpunkParams(): EditParams {
  const base = defaultParams();
  return {
    ...base,
    light: { exposure: 0.4, contrast: 0, highlights: 30, shadows: 0, whites: 34, blacks: 0 },
    hsl: {
      ...base.hsl,
      blue: { hue: 15, sat: -25, lum: 5 },
      aqua: { hue: -20, sat: 40, lum: -12 },
    },
    grading: { ...base.grading, shadows: { hue: 285, sat: 35, lum: -10 } },
  };
}

export function tokyoGhoulParams(): EditParams {
  const base = defaultParams();
  const purple = { hue: 20, sat: 8, lum: -8 };
  return {
    ...base,
    light: { exposure: -0.18, contrast: 24, highlights: -38, shadows: -30, whites: 12, blacks: -34 },
    hsl: {
      ...base.hsl,
      red: { hue: -6, sat: -12, lum: 7 },
      aqua: { hue: -22, sat: -22, lum: -20 },
      // The source gives one "Purple/Magenta" setting, so both channels share it.
      purple: { ...purple },
      magenta: { ...purple },
    },
    grading: { ...base.grading, highlights: { hue: 346, sat: 10, lum: 2 } },
  };
}

export function builtInPresets(): Preset[] {
  return [
    { id: MORIOH_ID, name: 'Morioh', builtIn: true, params: moriohParams() },
    { id: CYBERPUNK_ID, name: 'Cyberpunk: Edgerunners', builtIn: true, params: cyberpunkParams() },
    { id: TOKYO_GHOUL_ID, name: 'Tokyo Ghoul', builtIn: true, params: tokyoGhoulParams() },
    { id: NEUTRAL_ID, name: 'Neutral', builtIn: true, params: defaultParams() },
  ];
}

/**
 * A preset at partial strength: every setting moves that fraction of the way from
 * neutral. Grading hues stay put because their saturation carries the strength, and
 * curves blend toward the diagonal. The crop always comes from `geometry`.
 */
export function blendPreset(preset: EditParams, strength: number, geometry: Geometry): EditParams {
  const t = Math.min(1, Math.max(0, strength));
  const base = defaultParams();
  const round = (v: number, places: number) => Number(v.toFixed(places));
  const mix = (a: number, b: number, places = 0) => round(a + (b - a) * t, places);

  const out = defaultParams();
  out.mono = preset.mono;
  out.geometry = { ...geometry };
  const scalars = (group: 'light' | 'color' | 'presence' | 'detail' | 'effects') => {
    const from = base[group] as unknown as Record<string, number>;
    const to = preset[group] as unknown as Record<string, number>;
    const target = out[group] as unknown as Record<string, number>;
    for (const key of Object.keys(target)) {
      target[key] = mix(from[key], to[key], key === 'exposure' || key === 'sharpenRadius' ? 2 : 0);
    }
  };
  scalars('light');
  scalars('color');
  scalars('presence');
  scalars('detail');
  scalars('effects');
  for (const ch of CURVE_CHANNELS) {
    out.curve[ch] = preset.curve[ch].map(([x, y]) => [x, round(x + (y - x) * t, 2)]);
  }
  for (const ch of HSL_CHANNELS) {
    const v = preset.hsl[ch];
    out.hsl[ch] = { hue: mix(0, v.hue), sat: mix(0, v.sat), lum: mix(0, v.lum) };
  }
  for (const zone of GRADE_ZONES) {
    const v = preset.grading[zone];
    out.grading[zone] = { hue: v.hue, sat: mix(0, v.sat), lum: mix(0, v.lum) };
  }
  out.grading.blending = mix(base.grading.blending, preset.grading.blending);
  out.grading.balance = mix(base.grading.balance, preset.grading.balance);
  return out;
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

  const scalars = (group: 'light' | 'color' | 'presence' | 'effects' | 'detail') => {
    const from = asObject(src[group]);
    const to = out[group] as unknown as Record<string, number>;
    const ranges = RANGES[group] as unknown as Record<string, Range>;
    for (const key of Object.keys(to)) to[key] = num(from[key], to[key], ranges[key]);
  };
  scalars('light');
  scalars('color');
  scalars('presence');
  scalars('effects');
  scalars('detail');
  out.mono = src.mono === true;

  const g = asObject(src.geometry);
  const unit = (v: unknown, fallback: number) => num(v, fallback, [0, 1]);
  out.geometry.x = unit(g.x, 0);
  out.geometry.y = unit(g.y, 0);
  out.geometry.w = Math.max(0.01, Math.min(1 - out.geometry.x, unit(g.w, 1)));
  out.geometry.h = Math.max(0.01, Math.min(1 - out.geometry.y, unit(g.h, 1)));
  out.geometry.angle = num(g.angle, 0, RANGES.angle);
  out.geometry.rot90 = Math.round(num(g.rot90, 0, [0, 3]));
  out.geometry.flipH = g.flipH === true;

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
  const known = ['light', 'color', 'presence', 'curve', 'hsl', 'grading', 'effects', 'detail'];
  if (!known.some((key) => key in params)) {
    throw new Error('That file does not contain PixelRoom preset settings.');
  }
  if (typeof root.version === 'number' && root.version > VERSION) {
    throw new Error('That preset was made by a newer version of PixelRoom.');
  }
  const name = typeof root.name === 'string' && root.name.trim() ? root.name.trim() : 'Imported';
  return { name: name.slice(0, 60), params: sanitizeParams(params) };
}

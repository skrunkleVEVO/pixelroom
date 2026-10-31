// The complete, serialisable description of an edit. Everything the shader
// needs derives from this object; the source pixels are never modified.

export type CurvePoint = [x: number, y: number];
export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue';
export const CURVE_CHANNELS: CurveChannel[] = ['rgb', 'red', 'green', 'blue'];

export const HSL_CHANNELS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const;
export type HslChannel = (typeof HSL_CHANNELS)[number];

export interface HslValue {
  hue: number;
  sat: number;
  lum: number;
}

export interface GradeValue {
  hue: number;
  sat: number;
  lum: number;
}

export const GRADE_ZONES = ['shadows', 'midtones', 'highlights'] as const;
export type GradeZone = (typeof GRADE_ZONES)[number];

export interface EditParams {
  light: {
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    whites: number;
    blacks: number;
  };
  color: { temperature: number; tint: number; vibrance: number; saturation: number };
  presence: { texture: number; clarity: number; dehaze: number };
  curve: Record<CurveChannel, CurvePoint[]>;
  hsl: Record<HslChannel, HslValue>;
  grading: Record<GradeZone, GradeValue> & { blending: number; balance: number };
  effects: {
    vignetteAmount: number;
    vignetteMidpoint: number;
    vignetteFeather: number;
    sharpening: number;
    grain: number;
  };
}

export type Range = readonly [min: number, max: number];

const BIPOLAR: Range = [-100, 100];
const UNIPOLAR: Range = [0, 100];

/** Allowed range of every scalar parameter; used by the UI and by sanitising. */
export const RANGES = {
  light: {
    exposure: [-5, 5] as Range,
    contrast: BIPOLAR,
    highlights: BIPOLAR,
    shadows: BIPOLAR,
    whites: BIPOLAR,
    blacks: BIPOLAR,
  },
  color: { temperature: BIPOLAR, tint: BIPOLAR, vibrance: BIPOLAR, saturation: BIPOLAR },
  presence: { texture: BIPOLAR, clarity: BIPOLAR, dehaze: BIPOLAR },
  hsl: { hue: BIPOLAR, sat: BIPOLAR, lum: BIPOLAR },
  grade: { hue: [0, 360] as Range, sat: UNIPOLAR, lum: BIPOLAR },
  grading: { blending: UNIPOLAR, balance: BIPOLAR },
  effects: {
    vignetteAmount: BIPOLAR,
    vignetteMidpoint: UNIPOLAR,
    vignetteFeather: UNIPOLAR,
    sharpening: UNIPOLAR,
    grain: UNIPOLAR,
  },
} as const;

export function identityCurve(): CurvePoint[] {
  return [
    [0, 0],
    [255, 255],
  ];
}

export function defaultParams(): EditParams {
  const hsl = {} as EditParams['hsl'];
  for (const ch of HSL_CHANNELS) hsl[ch] = { hue: 0, sat: 0, lum: 0 };
  return {
    light: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    color: { temperature: 0, tint: 0, vibrance: 0, saturation: 0 },
    presence: { texture: 0, clarity: 0, dehaze: 0 },
    curve: {
      rgb: identityCurve(),
      red: identityCurve(),
      green: identityCurve(),
      blue: identityCurve(),
    },
    hsl,
    grading: {
      shadows: { hue: 0, sat: 0, lum: 0 },
      midtones: { hue: 0, sat: 0, lum: 0 },
      highlights: { hue: 0, sat: 0, lum: 0 },
      blending: 50,
      balance: 0,
    },
    effects: {
      vignetteAmount: 0,
      vignetteMidpoint: 50,
      vignetteFeather: 50,
      sharpening: 0,
      grain: 0,
    },
  };
}

export function cloneParams(p: EditParams): EditParams {
  return JSON.parse(JSON.stringify(p));
}

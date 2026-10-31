import { describe, expect, it } from 'vitest';
import { buildCurveLut, createSpline, LUT_SIZE } from '../engine/curves';
import { defaultParams } from '../engine/params';
import { moriohParams, presetFromJson, presetToJson, sanitizeParams } from './presets';

describe('Morioh preset', () => {
  const m = moriohParams();

  it('has the exact specified values', () => {
    expect(m.light).toEqual({ exposure: 0.2, contrast: 25, highlights: -35, shadows: 30, whites: 15, blacks: -10 });
    expect(m.color).toEqual({ temperature: 12, tint: -6, vibrance: 28, saturation: 8 });
    expect(m.presence).toEqual({ texture: 10, clarity: 15, dehaze: 8 });
    expect(m.curve.rgb).toEqual([[0, 8], [64, 60], [128, 132], [192, 198], [255, 255]]);
    expect(m.curve.blue).toEqual([[0, 12], [128, 118], [255, 245]]);
    expect(m.curve.red).toEqual([[0, 0], [255, 255]]);
    expect(m.curve.green).toEqual([[0, 0], [255, 255]]);
    expect(m.hsl).toEqual({
      red: { hue: 10, sat: 20, lum: 0 },
      orange: { hue: -8, sat: 15, lum: 10 },
      yellow: { hue: -35, sat: 45, lum: 15 },
      green: { hue: -65, sat: -30, lum: 10 },
      aqua: { hue: -25, sat: 35, lum: 5 },
      blue: { hue: 25, sat: 40, lum: -10 },
      purple: { hue: 15, sat: 25, lum: 0 },
      magenta: { hue: 10, sat: 15, lum: 0 },
    });
    expect(m.grading).toEqual({
      shadows: { hue: 270, sat: 18, lum: -5 },
      midtones: { hue: 45, sat: 10, lum: 0 },
      highlights: { hue: 55, sat: 22, lum: 5 },
      blending: 60,
      balance: 15,
    });
    expect(m.effects).toMatchObject({ vignetteAmount: -12, vignetteMidpoint: 50, vignetteFeather: 60, sharpening: 40 });
  });

  it('survives a JSON export and import unchanged', () => {
    const { name, params } = presetFromJson(presetToJson({ name: 'Morioh', params: m }));
    expect(name).toBe('Morioh');
    expect(params).toEqual(m);
  });
});

describe('preset import', () => {
  it('rejects non-JSON and unrelated JSON', () => {
    expect(() => presetFromJson('not json')).toThrow(/valid JSON/);
    expect(() => presetFromJson('{"hello":1}')).toThrow(/preset settings/);
  });

  it('rejects presets from a newer format version', () => {
    expect(() => presetFromJson('{"version":99,"params":{"light":{}}}')).toThrow(/newer/);
  });

  it('fills gaps with neutral values and clamps out-of-range numbers', () => {
    const p = sanitizeParams({
      light: { exposure: 99, contrast: 'high', shadows: 12 },
      grading: { shadows: { hue: 900, sat: -5 } },
    });
    expect(p.light.exposure).toBe(5);
    expect(p.light.contrast).toBe(0);
    expect(p.light.shadows).toBe(12);
    expect(p.grading.shadows).toEqual({ hue: 360, sat: 0, lum: 0 });
    expect(p.effects).toEqual(defaultParams().effects);
  });

  it('sorts curve points, drops bad ones and rejects curves with too few points', () => {
    const p = sanitizeParams({
      curve: {
        rgb: [[255, 255], [0, 0], [128, 'x'], [128, 140], [128, 150]],
        red: [[10, 10]],
      },
    });
    expect(p.curve.rgb).toEqual([[0, 0], [128, 140], [255, 255]]);
    expect(p.curve.red).toEqual([[0, 0], [255, 255]]);
  });
});

describe('tone curve spline', () => {
  it('passes through every control point', () => {
    const points = moriohParams().curve.rgb;
    const spline = createSpline(points);
    for (const [x, y] of points) expect(spline(x)).toBeCloseTo(y, 6);
  });

  it('never overshoots between points of a monotone curve', () => {
    const spline = createSpline([[0, 0], [100, 10], [110, 240], [255, 255]]);
    let last = -Infinity;
    for (let x = 0; x <= 255; x += 0.5) {
      const y = spline(x);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      expect(y).toBeLessThanOrEqual(255);
      last = y;
    }
  });

  it('holds end values flat outside the point range', () => {
    const spline = createSpline([[20, 30], [200, 210]]);
    expect(spline(0)).toBe(30);
    expect(spline(255)).toBe(210);
  });

  it('bakes an identity LUT for neutral curves', () => {
    const lut = buildCurveLut(defaultParams().curve);
    for (let i = 0; i < LUT_SIZE; i += 97) {
      expect(lut[i * 4]).toBeCloseTo(i / (LUT_SIZE - 1), 5);
      expect(lut[i * 4 + 2]).toBeCloseTo(i / (LUT_SIZE - 1), 5);
    }
  });

  it('composes the channel curve after the master curve', () => {
    const lut = buildCurveLut(moriohParams().curve);
    // Input 0: master lifts to 8, then Blue maps 8 -> just above 12; Red stays 8.
    expect(lut[0] * 255).toBeCloseTo(8, 3);
    expect(lut[2] * 255).toBeGreaterThan(12);
    expect(lut[2] * 255).toBeLessThan(20);
  });
});

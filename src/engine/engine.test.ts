import { describe, expect, it } from 'vitest';
import { autoTone, autoWhiteBalance, neutralize, whiteBalanceGains } from './auto';
import {
  applyAffine,
  constrainCrop,
  cropFit,
  cropToAspect,
  defaultGeometry,
  flipGeometry,
  outputSize,
  outputToSource,
  rotateGeometry,
} from './geometry';
import { findExif, insertExif, parseExif, patchExif, readOrientation } from './metadata';
import { defaultParams, isToneNeutral } from './params';
import { FIT_VIEW, imageRect } from './view';

const W = 6000;
const H = 4000;

describe('geometry', () => {
  it('maps an untouched photo onto itself', () => {
    const g = defaultGeometry();
    expect(outputSize(g, W, H)).toEqual({ width: W, height: H });
    const m = outputToSource(g, W, H);
    expect(applyAffine(m, 0.25, 0.75)[0]).toBeCloseTo(0.25, 10);
    expect(applyAffine(m, 0.25, 0.75)[1]).toBeCloseTo(0.75, 10);
  });

  it('maps a crop onto whole source pixels', () => {
    const g = { ...defaultGeometry(), x: 0.1, y: 0.25, w: 0.5, h: 0.5 };
    expect(outputSize(g, W, H)).toEqual({ width: 3000, height: 2000 });
    const m = outputToSource(g, W, H);
    expect(applyAffine(m, 0, 0)[0] * W).toBeCloseTo(600, 6);
    expect(applyAffine(m, 0, 0)[1] * H).toBeCloseTo(1000, 6);
    // One output pixel advances exactly one source pixel.
    expect((applyAffine(m, 1 / 3000, 0)[0] - applyAffine(m, 0, 0)[0]) * W).toBeCloseTo(1, 6);
  });

  it('sends each corner to the right place through a quarter turn', () => {
    const g = rotateGeometry(defaultGeometry(), true);
    expect(outputSize(g, W, H)).toEqual({ width: H, height: W });
    const m = outputToSource(g, W, H);
    // Clockwise: the top-left of the output is the source's bottom-left.
    expect(applyAffine(m, 0, 0)[0]).toBeCloseTo(0, 10);
    expect(applyAffine(m, 0, 0)[1]).toBeCloseTo(1, 10);
    expect(applyAffine(m, 1, 0)[0]).toBeCloseTo(0, 10);
    expect(applyAffine(m, 1, 0)[1]).toBeCloseTo(0, 10);
  });

  it('keeps showing the same source area when turned or flipped', () => {
    const start = { ...defaultGeometry(), x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const centre = (g: typeof start) => applyAffine(outputToSource(g, W, H), 0.5, 0.5);
    const [cx, cy] = centre(start);
    for (const g of [
      rotateGeometry(start, true),
      rotateGeometry(start, false),
      rotateGeometry(rotateGeometry(start, true), true),
      flipGeometry(start),
    ]) {
      const [x, y] = centre(g);
      expect(x).toBeCloseTo(cx, 3);
      expect(y).toBeCloseTo(cy, 3);
    }
  });

  it('flip keeps the same centre when straightened too', () => {
    const start = { ...defaultGeometry(), x: 0.3, y: 0.3, w: 0.2, h: 0.2, angle: 7 };
    const before = applyAffine(outputToSource(start, W, H), 0.5, 0.5);
    const after = applyAffine(outputToSource(flipGeometry(start), W, H), 0.5, 0.5);
    expect(after[0]).toBeCloseTo(before[0], 3);
    expect(after[1]).toBeCloseTo(before[1], 3);
  });

  it('shrinks a straightened crop until no corner leaves the photo', () => {
    const tilted = { ...defaultGeometry(), angle: 12 };
    expect(cropFit(tilted, W, H)).toBeLessThan(1);
    const g = constrainCrop(tilted, W, H);
    expect(cropFit(g, W, H)).toBeCloseTo(1, 9);
    const m = outputToSource(g, W, H);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const [s, t] = applyAffine(m, u, v);
      for (const value of [s, t]) {
        expect(value).toBeGreaterThanOrEqual(-1e-3);
        expect(value).toBeLessThanOrEqual(1 + 1e-3);
      }
    }
    // Keeps the aspect ratio of the crop.
    expect((g.w * W) / (g.h * H)).toBeCloseTo(W / H, 6);
  });

  it('leaves a crop that already fits untouched', () => {
    const g = { ...defaultGeometry(), x: 0.3, y: 0.3, w: 0.4, h: 0.4, angle: 3 };
    expect(constrainCrop(g, W, H)).toBe(g);
  });

  it('crops to an aspect ratio in pixels', () => {
    const g = cropToAspect(defaultGeometry(), W, H, 1);
    const size = outputSize(g, W, H);
    expect(size.width).toBe(size.height);
    expect(size.height).toBe(H);
  });
});

describe('view', () => {
  const pane = { x: 0, y: 0, w: 1000, h: 800 };

  it('fits inside the margin', () => {
    const r = imageRect(FIT_VIEW, W, H, pane, 10);
    expect(r.w).toBe(980);
    expect(r.x).toBe(10);
  });

  it('at 1:1 lands on whole device pixels with no scaling', () => {
    const r = imageRect({ zoom: 1, cx: 0.37, cy: 0.61 }, W, H, pane, 10);
    expect(r.w).toBe(W);
    expect(r.h).toBe(H);
    expect(r.scale).toBe(1);
    expect(Number.isInteger(r.x)).toBe(true);
    expect(Number.isInteger(r.y)).toBe(true);
  });

  it('never pans past the edge of the photo', () => {
    const r = imageRect({ zoom: 1, cx: 0, cy: 1 }, W, H, pane, 10);
    expect(r.x).toBe(0);
    expect(r.y).toBe(800 - H);
  });
});

describe('white balance', () => {
  it('neutral settings apply no gain', () => {
    const [r, g, b] = whiteBalanceGains(0, 0);
    expect([r, g, b]).toEqual([1, 1, 1]);
  });

  it('a picked colour comes out neutral after its correction', () => {
    const linear = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const [R, G, B] = [150, 140, 128];
    const { temperature, tint } = neutralize(R, G, B);
    const [gr, gg, gb] = whiteBalanceGains(temperature, tint);
    const out = [linear(R) * gr, linear(G) * gg, linear(B) * gb];
    expect(Math.abs(out[0] - out[1])).toBeLessThan(0.01);
    expect(Math.abs(out[2] - out[1])).toBeLessThan(0.01);
  });

  it('cools a warm cast and leaves a neutral photo alone', () => {
    const fill = (r: number, g: number, b: number) => {
      const d = new Uint8ClampedArray(400);
      for (let i = 0; i < d.length; i += 4) d.set([r, g, b, 255], i);
      return d;
    };
    expect(autoWhiteBalance(fill(180, 140, 100)).temperature).toBeLessThan(0);
    expect(autoWhiteBalance(fill(128, 128, 128))).toEqual({ temperature: 0, tint: 0 });
  });
});

describe('auto tone', () => {
  const flat = (v: number) => {
    const d = new Uint8ClampedArray(4000);
    for (let i = 0; i < d.length; i += 4) d.set([v, v, v, 255], i);
    return d;
  };
  it('brightens dark photos and darkens bright ones', () => {
    expect(autoTone(flat(30)).exposure).toBeGreaterThan(0);
    expect(autoTone(flat(230)).exposure).toBeLessThan(0);
  });
  it('holds exposure near mid grey', () => {
    expect(Math.abs(autoTone(flat(118)).exposure)).toBeLessThan(0.1);
  });
});

describe('neutral detection', () => {
  it('ignores the crop but notices any tone change', () => {
    const p = defaultParams();
    expect(isToneNeutral(p)).toBe(true);
    p.geometry.angle = 5;
    expect(isToneNeutral(p)).toBe(true);
    p.light.exposure = 0.01;
    expect(isToneNeutral(p)).toBe(false);
  });
});

/** A little-endian EXIF block: orientation 6, a model, an Exif IFD, GPS, and a thumbnail. */
function buildExif(): Uint8Array {
  const bytes = new Uint8Array(400);
  const dv = new DataView(bytes.buffer);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  const T = 6;
  bytes.set([0x49, 0x49], T);
  dv.setUint16(T + 2, 42, true);
  dv.setUint32(T + 4, 8, true);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    dv.setUint16(T + at, tag, true);
    dv.setUint16(T + at + 2, type, true);
    dv.setUint32(T + at + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(T + at + 8, value, true);
    else dv.setUint32(T + at + 8, value, true);
  };
  dv.setUint16(T + 8, 4, true);
  entry(10, 0x0110, 2, 8, 200); // Model
  entry(22, 0x0112, 3, 1, 6); // Orientation
  entry(34, 0x8769, 4, 1, 80); // Exif IFD
  entry(46, 0x8825, 4, 1, 120); // GPS IFD
  dv.setUint32(T + 58, 150, true); // IFD1
  dv.setUint16(T + 80, 2, true);
  entry(82, 0x8827, 3, 1, 400); // ISO
  entry(94, 0xa002, 4, 1, 6000); // PixelXDimension
  dv.setUint16(T + 120, 1, true);
  entry(122, 0x0002, 5, 3, 240); // GPSLatitude, stored out of line
  bytes.set([9, 9, 9, 9, 9, 9, 9, 9], T + 240);
  dv.setUint16(T + 150, 2, true);
  entry(152, 0x0201, 4, 1, 300); // thumbnail offset
  entry(164, 0x0202, 4, 1, 16); // thumbnail length
  bytes.set(new Array(16).fill(7), T + 300);
  bytes.set([...'TestCam\0'].map((c) => c.charCodeAt(0)), T + 200);
  return bytes;
}

describe('exif', () => {
  const payload = buildExif();

  it('reads what the panel shows', () => {
    expect(parseExif(payload)).toMatchObject({ camera: 'TestCam', iso: 400 });
    expect(readOrientation(payload)).toBe(6);
  });

  it('is told the truth about the exported file', () => {
    const out = patchExif(payload, { width: 1234, height: 800, keepLocation: true }) as Uint8Array;
    expect(readOrientation(out)).toBe(1);
    const dv = new DataView(out.buffer, out.byteOffset);
    expect(dv.getUint32(6 + 94 + 8, true)).toBe(1234);
    expect(out[6 + 300]).toBe(0); // thumbnail erased
    expect(dv.getUint32(6 + 58, true)).toBe(0); // and unlinked
    expect(out[6 + 240]).toBe(9); // location kept when asked
  });

  it('erases location bytes rather than just unlinking them', () => {
    const out = patchExif(payload, { width: 1, height: 1, keepLocation: false }) as Uint8Array;
    expect(Array.from(out.subarray(6 + 240, 6 + 248))).toEqual(new Array(8).fill(0));
    expect(new DataView(out.buffer, out.byteOffset).getUint16(6 + 120, true)).toBe(0);
  });

  it('never modifies the original', () => {
    const before = payload.slice();
    patchExif(payload, { width: 1, height: 1, keepLocation: false });
    expect(payload).toEqual(before);
  });

  it('round-trips through a JPEG', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 3, 1, 0xff, 0xda]);
    const withExif = insertExif(jpeg, payload);
    expect(findExif(withExif)).toEqual(payload);
    expect(findExif(jpeg)).toBeNull();
  });

  it('copes with garbage', () => {
    const junk = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3, 4]);
    expect(parseExif(junk)).toEqual({});
    expect(patchExif(junk, { width: 1, height: 1, keepLocation: true })).toBeNull();
    expect(readOrientation(junk)).toBe(1);
  });
});

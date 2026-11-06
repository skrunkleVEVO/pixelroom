import { describe, expect, it } from 'vitest';
import { FILTERS, autoEnhance, findFilter, isPixelNeutral, neutralAdjustments, resolveLook } from './adjust';
import { encodeToTarget, formatBytes, baseName } from './encode';
import { clampTransform, coverScale, defaultTransform, outputSize, placePhoto } from './layout';
import { contrastColor } from './text';
import { buildZip, crc32, uniqueNames } from './zip';

describe('layout', () => {
  it('cover scale fills the frame, more when rotated', () => {
    expect(coverScale(1080, 1350, 4000, 3000, 0)).toBeCloseTo(0.45);
    expect(coverScale(100, 100, 100, 100, Math.PI / 4)).toBeCloseTo(Math.SQRT2);
  });

  it('gives the standard social sizes', () => {
    const t = defaultTransform();
    expect(outputSize(4 / 5, 'social', 4000, 3000, 'fill', t)).toEqual([1080, 1350]);
    expect(outputSize(9 / 16, 'social', 4000, 3000, 'fill', t)).toEqual([1080, 1920]);
    expect(outputSize(1, 'social', 4000, 3000, 'fill', t)).toEqual([1080, 1080]);
    expect(outputSize(16 / 9, 'social', 4000, 3000, 'fill', t)).toEqual([1920, 1080]);
    expect(outputSize(1.91, 'social', 4000, 3000, 'fill', t)).toEqual([1920, 1005]);
  });

  it('full size maps photo pixels 1:1', () => {
    const [w, h] = outputSize(1, 'full', 4000, 3000, 'fill', defaultTransform());
    expect([w, h]).toEqual([3000, 3000]);
    const p = placePhoto(w, h, 4000, 3000, 'fill', defaultTransform());
    expect(p.scale).toBeCloseTo(1);
  });

  it('caps huge outputs to what phones can hold', () => {
    const [w, h] = outputSize(1, 'full', 9000, 9000, 'fit', { ...defaultTransform(), zoom: 0.4 });
    expect(w * h).toBeLessThanOrEqual(16_000_000);
  });

  it('keeps the frame covered in fill mode', () => {
    const W = 0.8;
    const H = 1;
    const corners = (t: ReturnType<typeof defaultTransform>) => {
      const p = placePhoto(W, H, 4000, 3000, 'fill', t);
      const hx = (4000 * p.scale) / 2;
      const hy = (3000 * p.scale) / 2;
      return [
        [0, 0],
        [W, 0],
        [W, H],
        [0, H],
      ].every(([x, y]) => {
        const dx = x - p.cx;
        const dy = y - p.cy;
        const c = Math.cos(-p.angle);
        const s = Math.sin(-p.angle);
        return Math.abs(dx * c - dy * s) <= hx + 1e-9 && Math.abs(dx * s + dy * c) <= hy + 1e-9;
      });
    };
    for (const straighten of [0, 7, -20, 45]) {
      const t = clampTransform(W, H, 4000, 3000, 'fill', { ...defaultTransform(), x: 5, y: -3, straighten });
      expect(corners(t)).toBe(true);
    }
    // Zoom below 1 is not allowed when filling.
    expect(clampTransform(W, H, 4000, 3000, 'fill', { ...defaultTransform(), zoom: 0.5 }).zoom).toBe(1);
    // A centred photo stays centred.
    const t = clampTransform(W, H, 4000, 3000, 'fill', { ...defaultTransform(), straighten: 10 });
    expect([t.x, t.y]).toEqual([0, 0]);
  });
});

describe('looks', () => {
  it('original with no adjustments is neutral', () => {
    expect(isPixelNeutral(resolveLook(FILTERS[0], 1, neutralAdjustments()))).toBe(true);
    expect(isPixelNeutral(resolveLook(findFilter('vivid'), 0, neutralAdjustments()))).toBe(true);
    expect(isPixelNeutral(resolveLook(findFilter('vivid'), 1, neutralAdjustments()))).toBe(false);
  });

  it('adds the user adjustments on top of the filter, clamped', () => {
    const look = resolveLook(findFilter('vivid'), 0.5, { ...neutralAdjustments(), saturation: 95 });
    expect(look.saturation).toBeCloseTo(1);
    expect(resolveLook(findFilter('mono'), 0.5, neutralAdjustments()).mono).toBe(0.5);
  });

  it('auto enhance brightens a dark, flat image', () => {
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < 100; i++) px.set([40 + (i % 20), 40 + (i % 20), 40 + (i % 20), 255], i * 4);
    const a = autoEnhance(px);
    expect(a.brightness).toBeGreaterThan(0);
    expect(a.contrast).toBeGreaterThan(0);
  });
});

describe('encoding', () => {
  type Fake = { width: number; height: number };
  // A fake encoder: size grows with pixel count and quality.
  const encode = async (c: Fake, q: number) => ({ size: Math.round(c.width * c.height * q) }) as Blob;
  const resize = (_: Fake, w: number, h: number) => ({ width: w, height: h }) as HTMLCanvasElement;

  it('finds a quality that fits', async () => {
    const r = await encodeToTarget({ width: 1000, height: 1000 } as HTMLCanvasElement, 600_000, encode as never, false, resize);
    expect(r.blob.size).toBeLessThanOrEqual(600_000);
    expect(r.quality).toBeGreaterThan(0.55);
    expect(r.width).toBe(1000);
  });

  it('shrinks the image when quality alone is not enough', async () => {
    const r = await encodeToTarget({ width: 1000, height: 1000 } as HTMLCanvasElement, 100_000, encode as never, false, resize);
    expect(r.blob.size).toBeLessThanOrEqual(100_000);
    expect(r.width).toBeLessThan(1000);
  });

  it('formats sizes and names', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(412_300)).toBe('412 KB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
    expect(baseName('IMG_1234.HEIC')).toBe('IMG_1234');
    expect(baseName('.jpg')).toBe('photo');
  });
});

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a well-formed archive', () => {
    const data = new TextEncoder().encode('hello');
    const zip = buildZip([{ name: 'a.txt', data }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(1);
  });

  it('dedupes names', () => {
    expect(uniqueNames(['a.jpg', 'A.jpg', 'b.jpg', 'a.jpg'])).toEqual(['a.jpg', 'A (2).jpg', 'b.jpg', 'a (3).jpg']);
  });
});

describe('text', () => {
  it('picks a readable label colour', () => {
    expect(contrastColor('#ffffff')).toBe('#000000');
    expect(contrastColor('#0a84ff')).toBe('#ffffff');
  });
});

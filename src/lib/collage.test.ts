import { describe, expect, it } from 'vitest';
import { LAYOUTS, cellRects, clampCells, hitCell, newCell, type CollageDoc } from './collage';

describe('collage layouts', () => {
  it('every layout has one cell per photo and tiles the frame exactly', () => {
    for (const [n, list] of Object.entries(LAYOUTS)) {
      for (const rects of list) {
        expect(rects.length).toBe(Number(n));
        const area = rects.reduce((a, [, , w, h]) => a + w * h, 0);
        expect(area).toBeCloseTo(1, 6);
        for (const [x, y, w, h] of rects) {
          expect(x).toBeGreaterThanOrEqual(-1e-9);
          expect(y).toBeGreaterThanOrEqual(-1e-9);
          expect(x + w).toBeLessThanOrEqual(1 + 1e-9);
          expect(y + h).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });

  it('applies equal outer margins and inner gaps', () => {
    // 1000 x 1000, gap 100 -> 50 px.
    const [a, b] = cellRects(LAYOUTS[2][0], 1000, 1000, 100);
    expect(a).toEqual({ x: 50, y: 50, w: 425, h: 900 });
    expect(b.x - (a.x + a.w)).toBeCloseTo(50);
    expect(1000 - (b.x + b.w)).toBeCloseTo(50);
    expect(hitCell([a, b], 600, 500)).toBe(1);
    expect(hitCell([a, b], 500, 500)).toBe(-1);
  });

  it('keeps each photo covering its cell', () => {
    const doc: CollageDoc = {
      format: 'square',
      layout: 0,
      gap: 0,
      radius: 0,
      bg: '#fff',
      cells: [newCell('a'), { photo: 'b', t: { ...newCell('b').t, x: 9, zoom: 0.2 } }],
    };
    const out = clampCells(doc, 1000, 1000, { a: { w: 4000, h: 3000 }, b: { w: 4000, h: 3000 } });
    expect(out.cells[1].t.zoom).toBe(1);
    expect(Math.abs(out.cells[1].t.x)).toBeLessThan(1);
    expect(out.cells[0]).toBe(doc.cells[0]);
  });
});

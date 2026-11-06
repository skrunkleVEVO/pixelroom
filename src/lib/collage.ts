// Collage layouts and drawing. A layout is a list of cells in a unit square;
// spacing and corner radius are applied when the cells are turned into pixels.
import { createCanvas, context2d } from './image';
import { clampTransform, defaultTransform, placePhoto, type FormatId, type Transform } from './layout';

/** x, y, width, height as fractions of the frame. */
export type Rect = [number, number, number, number];

/** Rows top to bottom, each split into `counts[i]` equal cells. */
function rows(counts: number[], heights?: number[]): Rect[] {
  const hs = heights ?? counts.map(() => 1 / counts.length);
  const out: Rect[] = [];
  let y = 0;
  counts.forEach((n, i) => {
    for (let j = 0; j < n; j++) out.push([j / n, y, 1 / n, hs[i]]);
    y += hs[i];
  });
  return out;
}

/** Columns left to right, each split into `counts[i]` equal cells. */
function cols(counts: number[], widths?: number[]): Rect[] {
  return rows(counts, widths).map(([x, y, w, h]) => [y, x, h, w]);
}

const BIG = [0.62, 0.38];
const HALF = [0.5, 0.25, 0.25];

export const LAYOUTS: Record<number, Rect[][]> = {
  2: [rows([2]), cols([2]), cols([1, 1], BIG), rows([1, 1], BIG)],
  3: [cols([1, 2]), rows([1, 2]), rows([3]), cols([3]), rows([2, 1]), cols([2, 1])],
  4: [rows([2, 2]), rows([1, 3], BIG), cols([1, 3], BIG), rows([4]), cols([4]), rows([3, 1], [0.38, 0.62])],
  5: [rows([2, 3]), rows([3, 2]), cols([2, 3]), rows([1, 4], [0.6, 0.4]), cols([1, 2, 2], HALF)],
  6: [rows([3, 3]), rows([2, 2, 2]), cols([3, 3]), rows([1, 2, 3], [0.4, 0.3, 0.3]), cols([1, 2, 3], [0.4, 0.3, 0.3])],
  7: [rows([2, 3, 2]), rows([3, 1, 3], [0.3, 0.4, 0.3]), rows([1, 3, 3], HALF), rows([4, 3])],
  8: [rows([3, 2, 3]), rows([4, 4]), rows([2, 2, 2, 2]), rows([1, 3, 4], HALF)],
  9: [rows([3, 3, 3]), rows([1, 4, 4], HALF), rows([2, 3, 4])],
  10: [rows([3, 4, 3]), rows([2, 3, 3, 2]), rows([1, 4, 5], HALF)],
};

export const MIN_PHOTOS = 2;
export const MAX_PHOTOS = 10;

export function layoutsFor(count: number): Rect[][] {
  return LAYOUTS[Math.min(MAX_PHOTOS, Math.max(MIN_PHOTOS, count))];
}

export interface Cell {
  /** Which photo fills this cell. */
  photo: string;
  /** Position inside the cell (always "fill"; zoom >= 1). */
  t: Transform;
}

export interface CollageDoc {
  format: FormatId;
  /** Index into layoutsFor(cells.length). */
  layout: number;
  cells: Cell[];
  /** 0..100 */
  gap: number;
  /** 0..100 */
  radius: number;
  bg: string;
}

export function newCell(photo: string): Cell {
  return { photo, t: defaultTransform() };
}

export function layoutRects(doc: CollageDoc): Rect[] {
  const list = layoutsFor(doc.cells.length);
  return list[doc.layout] ?? list[0];
}

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;

export function gapPx(gap: number, W: number, H: number): number {
  return (gap / 100) * 0.05 * Math.min(W, H);
}

export function radiusPx(radius: number, W: number, H: number): number {
  return (radius / 100) * 0.07 * Math.min(W, H);
}

/** Cells in frame pixels. Outer margin equals the gap between cells. */
export function cellRects(rects: Rect[], W: number, H: number, gap: number): PxRect[] {
  const g = gapPx(gap, W, H);
  const iw = W - 2 * g;
  const ih = H - 2 * g;
  return rects.map(([x, y, w, h]) => {
    const left = g + x * iw + (x > EPS ? g / 2 : 0);
    const right = g + (x + w) * iw - (x + w < 1 - EPS ? g / 2 : 0);
    const top = g + y * ih + (y > EPS ? g / 2 : 0);
    const bottom = g + (y + h) * ih - (y + h < 1 - EPS ? g / 2 : 0);
    return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
  });
}

/** Which cell (index) contains frame point (px, py), or -1. */
export function hitCell(cells: PxRect[], px: number, py: number): number {
  return cells.findIndex((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h);
}

/** Keeps every cell's photo covering its cell, for a W x H frame. */
export function clampCells(
  doc: CollageDoc,
  W: number,
  H: number,
  sizes: Record<string, { w: number; h: number }>,
): CollageDoc {
  const px = cellRects(layoutRects(doc), W, H, doc.gap);
  let changed = false;
  const cells = doc.cells.map((cell, i) => {
    const s = sizes[cell.photo];
    if (!s) return cell;
    const t = clampTransform(px[i].w, px[i].h, s.w, s.h, 'fill', cell.t);
    if (t.x === cell.t.x && t.y === cell.t.y && t.zoom === cell.t.zoom) return cell;
    changed = true;
    return { ...cell, t };
  });
  return changed ? { ...doc, cells } : doc;
}

export interface CollageImage {
  img: CanvasImageSource;
  /** Logical size the transforms refer to. */
  w: number;
  h: number;
}

function roundedPath(ctx: CanvasRenderingContext2D, r: PxRect, radius: number) {
  const rad = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  if (rad <= 0.5) {
    ctx.rect(r.x, r.y, r.w, r.h);
    return;
  }
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

export function drawCollage(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  doc: CollageDoc,
  images: Record<string, CollageImage>,
): PxRect[] {
  const cells = cellRects(layoutRects(doc), W, H, doc.gap);
  const radius = radiusPx(doc.radius, W, H);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = doc.bg;
  ctx.fillRect(0, 0, W, H);
  doc.cells.forEach((cell, i) => {
    const r = cells[i];
    const image = images[cell.photo];
    if (!r || !image) return;
    ctx.save();
    roundedPath(ctx, r, radius);
    ctx.clip();
    const t = clampTransform(r.w, r.h, image.w, image.h, 'fill', cell.t);
    const p = placePhoto(r.w, r.h, image.w, image.h, 'fill', t);
    ctx.translate(r.x + p.cx, r.y + p.cy);
    ctx.rotate(p.angle);
    if (t.flip) ctx.scale(-1, 1);
    const w = image.w * p.scale;
    const h = image.h * p.scale;
    ctx.drawImage(image.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  });
  ctx.restore();
  return cells;
}

/** Renders the finished collage at W x H. */
export function renderCollage(W: number, H: number, doc: CollageDoc, images: Record<string, CollageImage>): HTMLCanvasElement {
  const canvas = createCanvas(W, H);
  drawCollage(context2d(canvas), W, H, doc, images);
  return canvas;
}

export { roundedPath };

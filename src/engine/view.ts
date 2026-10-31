// Where the image sits on screen, in device pixels. Positions snap to whole device
// pixels so that at 1:1 one source pixel lands on exactly one screen pixel.

export type Zoom = 'fit' | 'fill' | number;

export interface ViewState {
  /** 'fit', 'fill', or device pixels per image pixel (1 is 1:1). */
  zoom: Zoom;
  /** The image point at the pane centre, 0-1. */
  cx: number;
  cy: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FIT_VIEW: ViewState = { zoom: 'fit', cx: 0.5, cy: 0.5 };
export const MIN_ZOOM = 1 / 32;
export const MAX_ZOOM = 16;

export function resolveScale(zoom: Zoom, imageW: number, imageH: number, pane: Rect, margin: number): number {
  if (typeof zoom === 'number') return zoom;
  const fx = Math.max(1, pane.w - 2 * margin) / imageW;
  const fy = Math.max(1, pane.h - 2 * margin) / imageH;
  if (zoom === 'fill') return Math.max(pane.w / imageW, pane.h / imageH);
  return Math.min(fx, fy);
}

export function imageRect(
  view: ViewState,
  imageW: number,
  imageH: number,
  pane: Rect,
  margin: number,
): Rect & { scale: number } {
  const scale = resolveScale(view.zoom, imageW, imageH, pane, margin);
  const w = Math.max(1, Math.round(imageW * scale));
  const h = Math.max(1, Math.round(imageH * scale));
  const place = (start: number, size: number, image: number, centre: number) => {
    if (image <= size) return start + Math.floor((size - image) / 2);
    const wanted = Math.round(start + size / 2 - centre * image);
    return Math.max(start + size - image, Math.min(start, wanted));
  };
  return {
    x: place(pane.x, pane.w, w, view.cx),
    y: place(pane.y, pane.h, h, view.cy),
    w,
    h,
    scale: w / imageW,
  };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Splits the canvas for Before / After: side by side, or stacked in portrait. */
export function panes(width: number, height: number, split: boolean): Rect[] {
  if (!split) return [{ x: 0, y: 0, w: width, h: height }];
  const gap = 2;
  if (height > width) {
    const h = Math.floor((height - gap) / 2);
    return [
      { x: 0, y: 0, w: width, h },
      { x: 0, y: h + gap, w: width, h: height - h - gap },
    ];
  }
  const w = Math.floor((width - gap) / 2);
  return [
    { x: 0, y: 0, w, h: height },
    { x: w + gap, y: 0, w: width - w - gap, h: height },
  ];
}

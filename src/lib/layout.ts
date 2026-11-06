// Frame formats and where the photo sits inside the frame. Everything here is pure
// math so preview and export place the photo identically at any resolution.

export type FormatId = 'original' | 'portrait' | 'square' | 'story' | 'p34' | 'landscape' | 'link';

export interface Format {
  id: FormatId;
  label: string;
  hint: string;
  /** Width / height. Null means "the photo's own shape". */
  ratio: number | null;
}

export const FORMATS: Format[] = [
  { id: 'original', label: 'Original', hint: 'No crop', ratio: null },
  { id: 'portrait', label: '4:5', hint: 'Post', ratio: 4 / 5 },
  { id: 'square', label: '1:1', hint: 'Square', ratio: 1 },
  { id: 'story', label: '9:16', hint: 'Story · TikTok', ratio: 9 / 16 },
  { id: 'p34', label: '3:4', hint: 'Photo post', ratio: 3 / 4 },
  { id: 'landscape', label: '16:9', hint: 'YouTube · X', ratio: 16 / 9 },
  { id: 'link', label: '1.91:1', hint: 'Wide post', ratio: 1.91 },
];

export type FitMode = 'fill' | 'fit';

export interface Transform {
  /** Multiplier on the base fill/fit scale. */
  zoom: number;
  /** Photo centre offset from the frame centre, as fractions of frame width and height. */
  x: number;
  y: number;
  /** Quarter turns clockwise. */
  turns: number;
  flip: boolean;
  /** Fine rotation in degrees. */
  straighten: number;
}

export function defaultTransform(): Transform {
  return { zoom: 1, x: 0, y: 0, turns: 0, flip: false, straighten: 0 };
}

/** Photo size after quarter turns. */
export function orientedSize(w: number, h: number, turns: number): [number, number] {
  return turns % 2 === 0 ? [w, h] : [h, w];
}

export function frameRatio(format: FormatId, photoW: number, photoH: number, turns: number): number {
  const f = FORMATS.find((x) => x.id === format);
  if (f?.ratio) return f.ratio;
  const [w, h] = orientedSize(photoW, photoH, turns);
  return w / h;
}

/** Smallest scale at which a pw x ph rectangle rotated by `angle` covers W x H. */
export function coverScale(W: number, H: number, pw: number, ph: number, angle: number): number {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return Math.max((W * c + H * s) / pw, (W * s + H * c) / ph);
}

export interface Placement {
  /** Photo centre in frame pixels. */
  cx: number;
  cy: number;
  /** Frame pixels per source pixel. */
  scale: number;
  /** Total rotation in radians (quarter turns + straighten). */
  angle: number;
  /** Fine rotation only, in radians. */
  fine: number;
}

export const MIN_FIT_ZOOM = 0.4;
export const MAX_ZOOM = 6;

export function baseScale(W: number, H: number, pw: number, ph: number, mode: FitMode, fine: number): number {
  return mode === 'fill' ? coverScale(W, H, pw, ph, fine) : Math.min(W / pw, H / ph);
}

/**
 * Where the photo goes in a W x H frame. `photoW/H` are the unrotated source size.
 * In fill mode the photo always covers the frame: zoom and offset are clamped.
 */
export function placePhoto(
  W: number,
  H: number,
  photoW: number,
  photoH: number,
  mode: FitMode,
  t: Transform,
): Placement {
  const [pw, ph] = orientedSize(photoW, photoH, t.turns);
  const fine = (t.straighten * Math.PI) / 180;
  const scale = baseScale(W, H, pw, ph, mode, fine) * t.zoom;
  return {
    cx: W / 2 + t.x * W,
    cy: H / 2 + t.y * H,
    scale,
    angle: fine + (t.turns * Math.PI) / 2,
    fine,
  };
}

/** Keeps a transform valid: zoom range, and in fill mode no empty corners. */
export function clampTransform(
  W: number,
  H: number,
  photoW: number,
  photoH: number,
  mode: FitMode,
  t: Transform,
): Transform {
  const zoom = Math.min(MAX_ZOOM, Math.max(mode === 'fill' ? 1 : MIN_FIT_ZOOM, t.zoom));
  const next = { ...t, zoom };
  if (mode === 'fit') {
    next.x = Math.min(0.5, Math.max(-0.5, t.x));
    next.y = Math.min(0.5, Math.max(-0.5, t.y));
    return next;
  }
  const [pw, ph] = orientedSize(photoW, photoH, t.turns);
  const fine = (t.straighten * Math.PI) / 180;
  const s = baseScale(W, H, pw, ph, 'fill', fine) * zoom;
  const hx = (pw * s) / 2;
  const hy = (ph * s) / 2;
  const cos = Math.cos(-fine);
  const sin = Math.sin(-fine);
  const rot = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];
  // Each frame corner, in the photo's rotated axes, must stay inside the photo:
  // that bounds the rotated offset u to a box. Clamp u, then rotate back.
  let [ux, uy] = rot(t.x * W, t.y * H);
  let loX = -Infinity;
  let hiX = Infinity;
  let loY = -Infinity;
  let hiY = Infinity;
  for (const [cx, cy] of [
    [-W / 2, -H / 2],
    [W / 2, -H / 2],
    [W / 2, H / 2],
    [-W / 2, H / 2],
  ]) {
    const [ax, ay] = rot(cx, cy);
    loX = Math.max(loX, ax - hx);
    hiX = Math.min(hiX, ax + hx);
    loY = Math.max(loY, ay - hy);
    hiY = Math.min(hiY, ay + hy);
  }
  ux = loX > hiX ? 0 : Math.min(hiX, Math.max(loX, ux));
  uy = loY > hiY ? 0 : Math.min(hiY, Math.max(loY, uy));
  // Rotate back by +fine.
  const c2 = Math.cos(fine);
  const s2 = Math.sin(fine);
  next.x = (ux * c2 - uy * s2) / W;
  next.y = (ux * s2 + uy * c2) / H;
  if (Math.abs(next.x) < 1e-9) next.x = 0;
  if (Math.abs(next.y) < 1e-9) next.y = 0;
  return next;
}

export type SizeMode = 'social' | 'hd' | 'full';

export const SIZE_MODES: { id: SizeMode; label: string; hint: string }[] = [
  { id: 'social', label: 'Social', hint: 'Best for apps' },
  { id: 'hd', label: 'HD', hint: '2× sharper' },
  { id: 'full', label: 'Full res', hint: 'Every pixel' },
];

/** Largest canvas iOS Safari reliably allows. */
export const MAX_AREA = 16_000_000;
export const MAX_EDGE = 8192;

function capSize(w: number, h: number): [number, number] {
  let k = Math.min(1, MAX_EDGE / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
  if (!Number.isFinite(k) || k <= 0) k = 1;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/**
 * Output pixel size. Social: short edge 1080 with the long edge at most 1920, which
 * gives exactly 1080x1350, 1080x1920 and 1920x1080 for the usual formats.
 * Full: the photo's own pixels land 1:1.
 */
export function outputSize(
  ratio: number,
  mode: SizeMode,
  photoW: number,
  photoH: number,
  fit: FitMode,
  t: Transform,
): [number, number] {
  if (mode === 'full') {
    // Place in a unit-height frame, then grow until one frame pixel = one photo pixel.
    const p = placePhoto(ratio, 1, photoW, photoH, fit, t);
    const H = 1 / p.scale;
    return capSize(ratio * H, H);
  }
  const short = mode === 'social' ? 1080 : 2160;
  const longCap = mode === 'social' ? 1920 : 3840;
  let w: number;
  let h: number;
  if (ratio >= 1) {
    h = short;
    w = short * ratio;
    if (w > longCap) {
      w = longCap;
      h = longCap / ratio;
    }
  } else {
    w = short;
    h = short / ratio;
    if (h > longCap) {
      h = longCap;
      w = longCap * ratio;
    }
  }
  return capSize(w, h);
}

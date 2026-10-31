// Crop, straighten, rotate and flip. All pure, so export and preview cannot disagree.
//
// The crop rectangle lives in the "frame": the photo after rotate/flip, then
// straightened about its own centre. x/y/w/h are fractions of the rotated photo's
// size, so one frame unit is always one source pixel and an unrotated crop maps
// output pixels exactly onto source pixels.

export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Straighten angle in degrees. */
  angle: number;
  /** Quarter turns clockwise, 0-3. */
  rot90: number;
  flipH: boolean;
}

export function defaultGeometry(): Geometry {
  return { x: 0, y: 0, w: 1, h: 1, angle: 0, rot90: 0, flipH: false };
}

export function orientedSize(g: Geometry, width: number, height: number): [number, number] {
  return g.rot90 % 2 ? [height, width] : [width, height];
}

interface CropPixels {
  left: number;
  top: number;
  width: number;
  height: number;
}

function cropPixels(g: Geometry, width: number, height: number): CropPixels {
  const [fw, fh] = orientedSize(g, width, height);
  const left = Math.round(g.x * fw);
  const top = Math.round(g.y * fh);
  return {
    left,
    top,
    width: Math.max(1, Math.min(fw - left, Math.round(g.w * fw))),
    height: Math.max(1, Math.min(fh - top, Math.round(g.h * fh))),
  };
}

export function outputSize(g: Geometry, width: number, height: number): { width: number; height: number } {
  const c = cropPixels(g, width, height);
  return { width: c.width, height: c.height };
}

/** Frame pixel -> source pixel, undoing straighten, then flip, then quarter turns. */
function frameToSource(g: Geometry, width: number, height: number, fx: number, fy: number): [number, number] {
  const [fw, fh] = orientedSize(g, width, height);
  const rad = (g.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = fx - fw / 2;
  const ry = fy - fh / 2;
  let ox = fw / 2 + cos * rx - sin * ry;
  const oy = fh / 2 + sin * rx + cos * ry;
  if (g.flipH) ox = fw - ox;
  switch (((g.rot90 % 4) + 4) % 4) {
    case 1:
      return [oy, height - ox];
    case 2:
      return [width - ox, height - oy];
    case 3:
      return [width - oy, ox];
    default:
      return [ox, oy];
  }
}

/** Affine [a,b,c,d,e,f]: s = a*u + b*v + c, t = d*u + e*v + f, all 0-1 with a top-left origin. */
export type Affine = [number, number, number, number, number, number];

export function outputToSource(g: Geometry, width: number, height: number): Affine {
  const c = cropPixels(g, width, height);
  const at = (u: number, v: number) => {
    const [sx, sy] = frameToSource(g, width, height, c.left + u * c.width, c.top + v * c.height);
    return [sx / width, sy / height];
  };
  const o = at(0, 0);
  const ux = at(1, 0);
  const vy = at(0, 1);
  return [ux[0] - o[0], vy[0] - o[0], o[0], ux[1] - o[1], vy[1] - o[1], o[1]];
}

export function applyAffine(m: Affine, u: number, v: number): [number, number] {
  return [m[0] * u + m[1] * v + m[2], m[3] * u + m[4] * v + m[5]];
}

/** The same mapping for GL's bottom-left origin, as the two rows the shader reads. */
export function affineToGl(m: Affine): [number[], number[]] {
  const [a, b, c, d, e, f] = m;
  return [
    [a, -b, b + c],
    [-d, e, 1 - e - f],
  ];
}

export function isPixelAligned(g: Geometry): boolean {
  return g.angle === 0;
}

/**
 * How far the crop must shrink toward the frame centre for all four corners to
 * land on the photo. 1 means it already fits.
 */
export function cropFit(g: Geometry, width: number, height: number): number {
  const [fw, fh] = orientedSize(g, width, height);
  const rad = (g.angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad)) < 1e-12 ? 0 : Math.cos(rad);
  const sin = Math.abs(Math.sin(rad)) < 1e-12 ? 0 : Math.sin(rad);
  let fit = 1;
  for (const [cx, cy] of [
    [g.x, g.y],
    [g.x + g.w, g.y],
    [g.x, g.y + g.h],
    [g.x + g.w, g.y + g.h],
  ]) {
    const rx = (cx - 0.5) * fw;
    const ry = (cy - 0.5) * fh;
    const ox = Math.abs(cos * rx - sin * ry);
    const oy = Math.abs(sin * rx + cos * ry);
    if (ox > 1e-9) fit = Math.min(fit, fw / 2 / ox);
    if (oy > 1e-9) fit = Math.min(fit, fh / 2 / oy);
  }
  return fit;
}

/** Shrinks the crop just enough to contain no empty corners, keeping its aspect. */
export function constrainCrop(g: Geometry, width: number, height: number): Geometry {
  const fit = cropFit(g, width, height);
  if (fit >= 1) return g;
  return {
    ...g,
    x: 0.5 + (g.x - 0.5) * fit,
    y: 0.5 + (g.y - 0.5) * fit,
    w: g.w * fit,
    h: g.h * fit,
  };
}

/** A centred crop of a pixel aspect ratio (w/h), as large as the current one allows. */
export function cropToAspect(g: Geometry, width: number, height: number, aspect: number): Geometry {
  const [fw, fh] = orientedSize(g, width, height);
  const curW = g.w * fw;
  const curH = g.h * fh;
  const nextW = Math.min(curW, curH * aspect);
  const nextH = nextW / aspect;
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const w = nextW / fw;
  const h = nextH / fh;
  return { ...g, x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Turning 90 degrees carries the crop rectangle along, so framing is preserved. */
export function rotateGeometry(g: Geometry, clockwise: boolean): Geometry {
  const rot90 = (g.rot90 + (clockwise ? 1 : 3)) % 4;
  return clockwise
    ? { ...g, rot90, x: 1 - g.y - g.h, y: g.x, w: g.h, h: g.w, angle: g.angle }
    : { ...g, rot90, x: g.y, y: 1 - g.x - g.w, w: g.h, h: g.w, angle: g.angle };
}

export function flipGeometry(g: Geometry): Geometry {
  return { ...g, flipH: !g.flipH, x: 1 - g.x - g.w, angle: -g.angle };
}

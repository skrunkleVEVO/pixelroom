// Draws a finished frame: background, photo, vignette, grain, text. The same code
// renders the preview and the export, at whatever pixel size it is given.
import type { Look } from './adjust';
import { createCanvas, context2d, fitWithin, releaseCanvas, resizeTo } from './image';
import { placePhoto, coverScale, orientedSize, type FitMode, type Transform } from './layout';
import { drawText, type TextLayer } from './text';

export type Background = { kind: 'blur' } | { kind: 'color'; color: string };

export interface Scene {
  /** The adjusted photo, in source orientation, at any resolution. */
  photo: HTMLCanvasElement | ImageBitmap;
  /** Changes whenever `photo`'s pixels change; keys the background cache. */
  version: number;
  /** The unrotated source size the transform refers to. */
  sourceW: number;
  sourceH: number;
  mode: FitMode;
  t: Transform;
  bg: Background;
  look: Pick<Look, 'vignette' | 'grain'>;
  texts: TextLayer[];
}

function drawPhoto(ctx: CanvasRenderingContext2D, s: Scene, cx: number, cy: number, scale: number, angle: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  if (s.t.flip) ctx.scale(-1, 1);
  const w = s.sourceW * scale;
  const h = s.sourceH * scale;
  ctx.drawImage(s.photo, -w / 2, -h / 2, w, h);
  ctx.restore();
}

let blurCache: { key: string; photo: unknown; canvas: HTMLCanvasElement } | null = null;

/** A soft, blurred copy of the photo covering a frame of the given shape. */
function blurredBackdrop(s: Scene, ratio: number): HTMLCanvasElement {
  const key = `${s.version}|${s.t.turns}|${s.t.flip}|${ratio.toFixed(4)}`;
  if (blurCache && blurCache.key === key && blurCache.photo === s.photo) return blurCache.canvas;
  // Shrinking to a few dozen pixels and growing back with smoothing is a cheap,
  // wide blur that works on every browser (canvas `filter` is missing on Safari).
  const sizes = [24, 96];
  let prev: HTMLCanvasElement | null = null;
  for (const short of sizes) {
    const w = ratio >= 1 ? Math.round(short * ratio) : short;
    const h = ratio >= 1 ? short : Math.round(short / ratio);
    const c = createCanvas(w, h);
    const ctx = context2d(c);
    if (!prev) {
      const [pw, ph] = orientedSize(s.sourceW, s.sourceH, s.t.turns);
      const scale = coverScale(w, h, pw, ph, 0) * 1.15;
      const tiny = resizeTo(s.photo, ...fitWithin(s.photo.width, s.photo.height, 72));
      drawPhoto(ctx, { ...s, photo: tiny }, w / 2, h / 2, scale, (s.t.turns * Math.PI) / 2);
      releaseCanvas(tiny);
    } else {
      ctx.drawImage(prev, 0, 0, w, h);
    }
    prev = c;
  }
  blurCache = { key, photo: s.photo, canvas: prev! };
  return prev!;
}

let grainTile: HTMLCanvasElement | null = null;

function grainPattern(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const size = 192;
  grainTile = createCanvas(size, size);
  const ctx = context2d(grainTile);
  const img = ctx.createImageData(size, size);
  let seed = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 128 + ((seed >>> 24) - 128) * 0.9;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return grainTile;
}

export function compose(ctx: CanvasRenderingContext2D, W: number, H: number, s: Scene): void {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // Background.
  if (s.bg.kind === 'blur') {
    ctx.drawImage(blurredBackdrop(s, W / H), 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = s.bg.color;
    ctx.fillRect(0, 0, W, H);
  }

  // Photo.
  const p = placePhoto(W, H, s.sourceW, s.sourceH, s.mode, s.t);
  if (s.mode === 'fit') {
    // A soft shadow lifts a framed photo off a plain or blurred background.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = Math.min(W, H) * 0.03;
    drawPhoto(ctx, s, p.cx, p.cy, p.scale, p.angle);
    ctx.restore();
  } else {
    drawPhoto(ctx, s, p.cx, p.cy, p.scale, p.angle);
  }

  // Vignette: an elliptical gradient over the whole frame.
  const v = s.look.vignette;
  if (v !== 0) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(W / 2, H / 2);
    const g = ctx.createRadialGradient(0, 0, 0.35, 0, 0, 1.45);
    const rgb = v > 0 ? '0,0,0' : '255,255,255';
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(1, `rgba(${rgb},${Math.abs(v) * 0.85})`);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  // Grain, scaled to the frame so every export size looks the same.
  if (s.look.grain > 0) {
    ctx.save();
    const k = Math.max(0.5, (Math.min(W, H) / 1080) * 1.4);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = s.look.grain * 0.55;
    ctx.scale(k, k);
    ctx.fillStyle = ctx.createPattern(grainPattern(), 'repeat')!;
    ctx.fillRect(0, 0, W / k, H / k);
    ctx.restore();
  }

  for (const layer of s.texts) drawText(ctx, layer, W, H);
  ctx.restore();
}

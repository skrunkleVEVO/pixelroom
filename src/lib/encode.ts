// Encoding canvases to files, including "make it smaller than N KB".
import { createCanvas, context2d, releaseCanvas, resizeTo } from './image';

export type OutFormat = 'jpeg' | 'webp' | 'png';

export const FORMAT_INFO: Record<OutFormat, { label: string; mime: string; ext: string }> = {
  jpeg: { label: 'JPG', mime: 'image/jpeg', ext: 'jpg' },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp' },
  png: { label: 'PNG', mime: 'image/png', ext: 'png' },
};

export type QualityId = 'high' | 'medium' | 'low' | 't2000' | 't1000' | 't500' | 't200';

export const QUALITIES: { id: QualityId; label: string; quality?: number; target?: number }[] = [
  { id: 'high', label: 'High', quality: 0.92 },
  { id: 'medium', label: 'Medium', quality: 0.8 },
  { id: 'low', label: 'Low', quality: 0.62 },
  { id: 't2000', label: '≤ 2 MB', target: 2_000_000 },
  { id: 't1000', label: '≤ 1 MB', target: 1_000_000 },
  { id: 't500', label: '≤ 500 KB', target: 500_000 },
  { id: 't200', label: '≤ 200 KB', target: 200_000 },
];

let webpOk: boolean | null = null;

/** Safari can't encode WebP; its toBlob silently falls back to PNG. */
export function canEncodeWebp(): boolean {
  if (webpOk === null) {
    try {
      webpOk = createCanvas(2, 2).toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
      webpOk = false;
    }
  }
  return webpOk;
}

export function availableFormats(): OutFormat[] {
  return canEncodeWebp() ? ['jpeg', 'webp', 'png'] : ['jpeg', 'png'];
}

export function encodeCanvas(canvas: HTMLCanvasElement, format: OutFormat, quality = 0.92): Promise<Blob> {
  let source = canvas;
  if (format === 'jpeg') {
    // JPEG has no alpha: flatten onto white rather than letting it turn black.
    source = createCanvas(canvas.width, canvas.height);
    const ctx = context2d(source);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, source.width, source.height);
    ctx.drawImage(canvas, 0, 0);
  }
  return new Promise<Blob>((resolve, reject) => {
    source.toBlob(
      (blob) => {
        if (source !== canvas) releaseCanvas(source);
        if (blob) resolve(blob);
        else reject(new Error('Saving failed — the image may be too large for this device. Try a smaller size.'));
      },
      FORMAT_INFO[format].mime,
      quality,
    );
  });
}

export interface Encoded {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
}

type EncodeFn = (canvas: HTMLCanvasElement, quality: number) => Promise<Blob>;

/**
 * Finds the highest quality that fits `target` bytes by bisection. If even low
 * quality is too big (or the format is lossless) the image is shrunk and tried again.
 */
export async function encodeToTarget(
  canvas: HTMLCanvasElement,
  target: number,
  encode: EncodeFn,
  lossless = false,
  resize: (c: HTMLCanvasElement, w: number, h: number) => HTMLCanvasElement = resizeTo,
): Promise<Encoded> {
  let current = canvas;
  let best: Encoded | null = null;
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { width, height } = current;
      if (lossless) {
        const blob = await encode(current, 1);
        best = { blob, width, height, quality: 1 };
        if (blob.size <= target) return best;
      } else {
        const top = await encode(current, 0.92);
        if (top.size <= target) return { blob: top, width, height, quality: 0.92 };
        let lo = 0.35;
        let hi = 0.92;
        const floor = await encode(current, lo);
        best = { blob: floor, width, height, quality: lo };
        if (floor.size <= target) {
          for (let i = 0; i < 6 && hi - lo > 0.02; i++) {
            const mid = (lo + hi) / 2;
            const blob = await encode(current, mid);
            if (blob.size <= target) {
              lo = mid;
              best = { blob, width, height, quality: mid };
            } else hi = mid;
          }
          return best;
        }
      }
      // Too big even at the lowest quality: shrink, aiming a little under.
      const k = Math.max(0.35, Math.min(0.92, Math.sqrt(target / best.blob.size) * 0.95));
      const next = resize(current, Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)));
      if (current !== canvas) releaseCanvas(current);
      current = next;
      if (current.width < 16 || current.height < 16) break;
    }
    return best!;
  } finally {
    if (current !== canvas) releaseCanvas(current);
  }
}

export async function encodeWith(
  canvas: HTMLCanvasElement,
  format: OutFormat,
  qualityId: QualityId,
): Promise<Encoded> {
  const q = QUALITIES.find((x) => x.id === qualityId) ?? QUALITIES[0];
  const run: EncodeFn = (c, quality) => encodeCanvas(c, format, quality);
  if (q.target) return encodeToTarget(canvas, q.target, run, format === 'png');
  const quality = format === 'png' ? 1 : q.quality!;
  const blob = await run(canvas, quality);
  return { blob, width: canvas.width, height: canvas.height, quality };
}

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`;
}

export function baseName(name: string): string {
  return (name.replace(/\.[^.]+$/, '') || 'photo').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'photo';
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

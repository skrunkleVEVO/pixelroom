// Decoding files and resizing pixels with good quality on every browser.

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This device ran out of memory for images. Try a smaller size.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Frees a canvas's pixel memory right away (iOS counts canvas memory strictly). */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 1;
  canvas.height = 1;
}

type Drawable = ImageBitmap | HTMLCanvasElement | HTMLImageElement;

/**
 * Resizes by halving first, so big reductions don't alias (a single drawImage at a
 * large ratio skips source pixels on some browsers), then a final exact step.
 */
export function resizeTo(source: Drawable, width: number, height: number): HTMLCanvasElement {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  let current: Drawable = source;
  let w = source.width;
  let h = source.height;
  while (w / 2 >= width && h / 2 >= height) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const step = createCanvas(w, h);
    context2d(step).drawImage(current, 0, 0, w, h);
    if (current instanceof HTMLCanvasElement && current !== source) releaseCanvas(current);
    current = step;
  }
  const out = createCanvas(width, height);
  context2d(out).drawImage(current, 0, 0, width, height);
  if (current instanceof HTMLCanvasElement && current !== source) releaseCanvas(current);
  return out;
}

/** Scales to fit within a long edge, never enlarging. */
export function fitWithin(width: number, height: number, longEdge: number): [number, number] {
  const k = Math.min(1, longEdge / Math.max(width, height));
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

export interface Decoded {
  image: ImageBitmap | HTMLCanvasElement;
  width: number;
  height: number;
}

/** Decodes a file upright (EXIF orientation applied). Throws a readable Error. */
export async function decodeFile(file: Blob): Promise<Decoded> {
  if ('createImageBitmap' in window) {
    try {
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image, width: image.width, height: image.height };
    } catch {
      // Some formats (HEIC on older Safari) only decode through <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = createCanvas(img.naturalWidth, img.naturalHeight);
    context2d(canvas).drawImage(img, 0, 0);
    return { image: canvas, width: canvas.width, height: canvas.height };
  } catch {
    throw new Error("This file couldn't be opened. Try a JPG, PNG, HEIC or WebP photo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function closeImage(image: ImageBitmap | HTMLCanvasElement): void {
  if (image instanceof HTMLCanvasElement) releaseCanvas(image);
  else image.close();
}

/** RGBA pixels of a small copy, for analysis. */
export function samplePixels(source: Drawable, edge = 96): Uint8ClampedArray {
  const [w, h] = fitWithin(source.width, source.height, edge);
  const small = resizeTo(source, w, h);
  const data = context2d(small).getImageData(0, 0, w, h).data;
  releaseCanvas(small);
  return data;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|avif|gif|bmp)$/i.test(file.name);
}

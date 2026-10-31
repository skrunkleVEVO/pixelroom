import { Renderer, type ExportOptions, type ImageSource } from '../engine/Renderer';
import { autoTone, autoWhiteBalance, neutralize } from '../engine/auto';
import { findExif, parseExif, patchExif } from '../engine/metadata';
import type { EditParams } from '../engine/params';
import { createSampleScene } from '../sample';
import { actions, activePhoto, getState, subscribe, type CatalogPhoto } from './store';

// Connects the store to the GPU. Parameter changes reach the renderer directly,
// without going through React, so dragging a slider re-renders only that slider.

let renderer: Renderer | null = null;
/** Pixels of the photo on screen. Other photos are decoded again when selected. */
let currentBitmap: ImageSource | null = null;
let sampleScene: HTMLCanvasElement | null = null;
let loadJob = 0;

// A GL context cannot be handed to a hot-swapped module, so engine edits reload.
import.meta.hot?.accept(() => location.reload());

export function attachRenderer(canvas: HTMLCanvasElement): void {
  if (renderer?.canvas === canvas) return;
  renderer = new Renderer(canvas);
  renderer.onAnalysis = (analysis) => {
    actions.setAnalysis(analysis);
    const s = getState();
    if (s.activeId) {
      const thumb = renderer?.captureThumbnail();
      if (thumb) actions.setThumb(s.activeId, thumb);
    }
  };

  const push = () => {
    const s = getState();
    renderer?.setDisplay({
      params: s.params,
      view: s.view,
      split: s.compare === 'side',
      peek: s.peek,
      framing: s.tool === 'crop',
      showClipping: s.showClipping,
    });
  };
  let last = getState();
  subscribe(() => {
    const s = getState();
    const changed =
      s.params !== last.params ||
      s.view !== last.view ||
      s.compare !== last.compare ||
      s.peek !== last.peek ||
      s.tool !== last.tool ||
      s.showClipping !== last.showClipping;
    last = s;
    if (changed) push();
  });
  push();

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__pixelroom = { renderer, getState, actions };
  }
}

export function setRendererLayout(width: number, height: number, dpr: number): void {
  renderer?.setLayout(width, height, dpr);
}

/** iOS Safari limits a canvas to this many pixels. */
const MAX_FALLBACK_PIXELS = 16_000_000;

/** For browsers whose createImageBitmap rejects these options. Images apply EXIF themselves. */
async function decodeWithImage(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, Math.sqrt(MAX_FALLBACK_PIXELS / (image.naturalWidth * image.naturalHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not allocate a canvas.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decode(file: File): Promise<ImageSource> {
  try {
    // Decodes at full size, applies EXIF orientation and converts to sRGB.
    return await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
  } catch {
    return decodeWithImage(file);
  }
}

function isJpeg(file: File): boolean {
  return file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
}

function show(source: ImageSource, id: string): void {
  if (!renderer) throw new Error('The renderer is not ready.');
  if (currentBitmap && currentBitmap !== source && 'close' in currentBitmap) currentBitmap.close();
  currentBitmap = source;
  actions.activatePhoto(id);
  // Parameters first, so the first frame of the new photo is already its own edit.
  const s = getState();
  renderer.setDisplay({ params: s.params, view: s.view, split: false, peek: false, framing: false });
  renderer.setImage(source);
  actions.imageLoaded();
}

/** A small render of a look on the open photo, keeping its current crop. */
export function presetThumbnail(params: EditParams): string | null {
  const geometry = getState().params.geometry;
  return renderer?.renderThumbnail({ ...params, geometry }) ?? null;
}

/** Imports files into the catalog and opens the first. Failures are reported per file. */
export async function importFiles(files: File[]): Promise<void> {
  let opened = false;
  const failed: string[] = [];
  for (const file of files) {
    try {
      const bitmap = await decode(file);
      const exifRaw = isJpeg(file) ? findExif(new Uint8Array(await file.arrayBuffer())) : null;
      const id = actions.addPhoto({
        name: file.name,
        file,
        width: bitmap.width,
        height: bitmap.height,
        exif: parseExif(exifRaw),
        exifRaw,
      });
      if (!opened) {
        show(bitmap, id);
        opened = true;
      } else {
        await thumbnailOnly(bitmap, id);
      }
    } catch (error) {
      console.error(error);
      failed.push(file.name);
    }
  }
  if (failed.length) {
    actions.notify(
      `Could not open ${failed.join(', ')}. Use a JPEG, PNG, WebP or AVIF: browsers cannot decode camera RAW files.`,
      true,
    );
  }
}

/** Gives a photo that is not on screen a filmstrip thumbnail, then frees its pixels. */
async function thumbnailOnly(bitmap: ImageSource, id: string): Promise<void> {
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 320 / long);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    actions.setThumb(id, canvas.toDataURL('image/jpeg', 0.85));
  }
  if ('close' in bitmap) bitmap.close();
}

export async function selectPhoto(id: string): Promise<void> {
  const s = getState();
  if (s.activeId === id) return;
  const photo = s.catalog.find((p) => p.id === id);
  if (!photo) return;
  const job = ++loadJob;
  try {
    const source: ImageSource = photo.file ? await decode(photo.file) : (sampleScene ??= createSampleScene());
    if (job !== loadJob) {
      if ('close' in source) source.close();
      return;
    }
    show(source, id);
  } catch (error) {
    console.error(error);
    actions.notify(`Could not reopen "${photo.name}".`, true);
  }
}

/** Selects the photo next to the active one in the filmstrip. */
export function stepPhoto(delta: number): void {
  const { catalog, activeId } = getState();
  const index = catalog.findIndex((p) => p.id === activeId);
  const next = catalog[index + delta];
  if (next) void selectPhoto(next.id);
}

export function openSample(): void {
  try {
    sampleScene ??= createSampleScene();
    const id = actions.addPhoto({
      name: 'sample-scene.png',
      file: null,
      width: sampleScene.width,
      height: sampleScene.height,
      exif: {},
      exifRaw: null,
    });
    show(sampleScene, id);
  } catch (error) {
    actions.notify(error instanceof Error ? error.message : 'Could not create the sample.', true);
  }
}

// ---------------------------------------------------------------------- tools

export function autoSettings(): void {
  const pixels = renderer?.sourcePixels();
  if (!pixels) return;
  const tone = autoTone(pixels);
  actions.change('Auto Settings', (p) => {
    p.light = tone;
  });
}

export function autoWb(): void {
  const pixels = renderer?.sourcePixels();
  if (!pixels) return;
  const wb = autoWhiteBalance(pixels);
  actions.change('White Balance: Auto', (p) => {
    p.color.temperature = wb.temperature;
    p.color.tint = wb.tint;
  });
}

/** White balance picker: makes the clicked spot neutral. */
export function pickWhiteBalance(cssX: number, cssY: number): boolean {
  const sample = renderer?.readSource(cssX, cssY);
  if (!sample) return false;
  const wb = neutralize(sample[0], sample[1], sample[2]);
  actions.change('White Balance: Custom', (p) => {
    p.color.temperature = wb.temperature;
    p.color.tint = wb.tint;
  });
  return true;
}

export function readColorAt(cssX: number, cssY: number): void {
  actions.setReadout(renderer?.readEdited(cssX, cssY) ?? null);
}

// --------------------------------------------------------------------- export

export interface ExportRequest extends Omit<ExportOptions, 'exif'> {
  metadata: 'all' | 'noLocation' | 'none';
}

export function exportPhoto({ metadata, ...options }: ExportRequest): Promise<Blob> {
  if (!renderer) return Promise.reject(new Error('The renderer is not ready.'));
  const photo: CatalogPhoto | null = activePhoto(getState());
  const raw = photo?.exifRaw ?? null;
  return renderer.exportFull(getState().params, {
    ...options,
    exif:
      raw && metadata !== 'none'
        ? (width, height) => patchExif(raw, { width, height, keepLocation: metadata === 'all' })
        : undefined,
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

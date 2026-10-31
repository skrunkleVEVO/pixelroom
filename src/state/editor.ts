import { Renderer, type ExportOptions, type ImageSource } from '../engine/Renderer';
import { createSampleScene } from '../sample';
import { actions, getState, subscribe } from './store';

// Connects the store to the GPU. Parameter changes reach the renderer directly,
// without going through React, so dragging a slider re-renders only that slider.

let renderer: Renderer | null = null;
let beforeCanvas: HTMLCanvasElement | null = null;

// A GL context cannot be handed to a hot-swapped module, so engine edits reload.
import.meta.hot?.accept(() => location.reload());

export function attachRenderer(canvas: HTMLCanvasElement, before: HTMLCanvasElement): void {
  beforeCanvas = before;
  if (renderer?.canvas === canvas) return;
  renderer = new Renderer(canvas);

  let lastParams = getState().params;
  subscribe(() => {
    const { params } = getState();
    if (params === lastParams) return;
    lastParams = params;
    renderer?.render(params);
  });

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__pixelroom = { renderer, getState, actions };
  }
}

function showImage(source: ImageSource, name: string): void {
  if (!renderer) throw new Error('The renderer is not ready.');
  renderer.setImage(source);
  actions.openPhoto({ name, width: source.width, height: source.height });
  renderer.render(getState().params);

  const proxy = renderer.previewCanvas;
  if (beforeCanvas && proxy) {
    beforeCanvas.width = proxy.width;
    beforeCanvas.height = proxy.height;
    beforeCanvas.getContext('2d')?.drawImage(proxy, 0, 0);
  }
}

export async function openFile(file: File): Promise<void> {
  try {
    // Decodes at full size, applies EXIF orientation and converts to sRGB.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
      premultiplyAlpha: 'none',
    });
    showImage(bitmap, file.name);
  } catch (error) {
    console.error(error);
    actions.notify(
      `Could not open "${file.name}". Use a JPEG, PNG, WebP or AVIF: browsers cannot decode camera RAW files.`,
      true,
    );
  }
}

export function openSample(): void {
  try {
    showImage(createSampleScene(), 'sample-scene.png');
  } catch (error) {
    actions.notify(error instanceof Error ? error.message : 'Could not create the sample.', true);
  }
}

export function exportPhoto(options: ExportOptions): Promise<Blob> {
  if (!renderer) return Promise.reject(new Error('The renderer is not ready.'));
  return renderer.exportFull(getState().params, options);
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

// Full-resolution rendering for export.
import { compose } from '../lib/compose';
import { context2d, createCanvas, fitWithin, releaseCanvas } from '../lib/image';
import { frameRatio, outputSize, placePhoto, type SizeMode } from '../lib/layout';
import { processor } from '../lib/processor';
import { lookOf, type Doc, type Photo } from './state';

export function exportSize(photo: Photo, doc: Doc, size: SizeMode): [number, number] {
  const ratio = frameRatio(doc.format, photo.width, photo.height, doc.t.turns);
  return outputSize(ratio, size, photo.width, photo.height, doc.mode, doc.t);
}

/** Renders the finished frame. The caller owns (and should release) the canvas. */
export function renderFrame(photo: Photo, doc: Doc, size: SizeMode): HTMLCanvasElement {
  const [W, H] = exportSize(photo, doc, size);
  const look = lookOf(doc);
  // Only process as many photo pixels as the output can show.
  const p = placePhoto(W, H, photo.width, photo.height, doc.mode, doc.t);
  const need = Math.min(1, p.scale * 1.02);
  const [pw, ph] = fitWithin(
    Math.round(photo.width * need),
    Math.round(photo.height * need),
    processor().maxSize,
  );
  const processed = processor().process(photo.source, pw, ph, look);
  const out = createCanvas(W, H);
  compose(context2d(out), W, H, {
    photo: processed,
    version: -Date.now(),
    sourceW: photo.width,
    sourceH: photo.height,
    mode: doc.mode,
    t: doc.t,
    bg: doc.bg,
    look,
    texts: doc.texts,
  });
  if (processed !== processor().canvas) releaseCanvas(processed);
  // The full-size texture is no longer needed; the preview re-uploads its proxy.
  processor().release();
  return out;
}

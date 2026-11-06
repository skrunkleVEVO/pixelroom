// Collage editor state: the photos, the layout doc, and undo history.
import {
  MAX_PHOTOS,
  clampCells,
  newCell,
  renderCollage,
  type CollageDoc,
  type CollageImage,
} from '../lib/collage';
import { closeImage, decodeFile, fitWithin, releaseCanvas, resizeTo } from '../lib/image';
import { FORMATS, outputSize } from '../lib/layout';
import { createStore } from '../lib/store';

export interface CollagePhoto {
  id: string;
  /** Capped-size copy used for export. */
  image: HTMLCanvasElement;
  /** Small copy for the live preview. */
  proxy: HTMLCanvasElement;
  name: string;
}

export interface CollageState {
  photos: Record<string, CollagePhoto>;
  doc: CollageDoc;
  past: CollageDoc[];
  future: CollageDoc[];
  selected: number | null;
  swapping: boolean;
  tab: 'layout' | 'style';
  busy: boolean;
}

export function defaultCollageDoc(): CollageDoc {
  return { format: 'portrait', layout: 0, cells: [], gap: 20, radius: 0, bg: '#ffffff' };
}

export const collage = createStore<CollageState>({
  photos: {},
  doc: defaultCollageDoc(),
  past: [],
  future: [],
  selected: null,
  swapping: false,
  tab: 'layout',
  busy: false,
});

const get = () => collage.get();
export const patchCollage = (p: Partial<CollageState>) => collage.set((s) => ({ ...s, ...p }));

export function ratioOf(doc: CollageDoc): number {
  return FORMATS.find((f) => f.id === doc.format)?.ratio ?? 4 / 5;
}

function sizes(s: CollageState) {
  const out: Record<string, { w: number; h: number }> = {};
  for (const p of Object.values(s.photos)) out[p.id] = { w: p.image.width, h: p.image.height };
  return out;
}

function normalize(s: CollageState, doc: CollageDoc): CollageDoc {
  const r = ratioOf(doc);
  return clampCells(doc, r * 1000, 1000, sizes(s));
}

// ------------------------------------------------------------------ history

let checkpointDoc: CollageDoc | null = null;

export function checkpoint(): void {
  checkpointDoc ??= get().doc;
}

export function commit(): void {
  const base = checkpointDoc;
  checkpointDoc = null;
  if (!base) return;
  collage.set((s) =>
    JSON.stringify(base) === JSON.stringify(s.doc) ? s : { ...s, past: [...s.past, base].slice(-60), future: [] },
  );
}

export function setDoc(update: (doc: CollageDoc) => CollageDoc): void {
  collage.set((s) => ({ ...s, doc: normalize(s, update(s.doc)) }));
}

export function applyDoc(update: (doc: CollageDoc) => CollageDoc): void {
  checkpoint();
  setDoc(update);
  commit();
}

export function undo(): void {
  collage.set((s) =>
    s.past.length
      ? { ...s, doc: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.doc, ...s.future], selected: null, swapping: false }
      : s,
  );
}

export function redo(): void {
  collage.set((s) =>
    s.future.length
      ? { ...s, doc: s.future[0], future: s.future.slice(1), past: [...s.past, s.doc], selected: null, swapping: false }
      : s,
  );
}

// ------------------------------------------------------------------ photos

let idCounter = 0;

/** Each photo is kept at a size a collage cell can use, not full resolution: ten
 *  full-size phone photos would exhaust a phone's memory. */
function capFor(count: number): number {
  return count <= 2 ? 3072 : count <= 4 ? 2400 : 1800;
}

async function loadPhotos(files: File[], totalCount: number): Promise<CollagePhoto[]> {
  const out: CollagePhoto[] = [];
  const cap = capFor(totalCount);
  const proxyEdge = totalCount <= 4 ? 1280 : 900;
  for (const file of files) {
    const decoded = await decodeFile(file);
    const image = resizeTo(decoded.image, ...fitWithin(decoded.width, decoded.height, cap));
    closeImage(decoded.image);
    const proxy = resizeTo(image, ...fitWithin(image.width, image.height, proxyEdge));
    out.push({ id: `p${Date.now().toString(36)}${idCounter++}`, image, proxy, name: file.name });
  }
  return out;
}

/** Starts a new collage. Throws a readable Error if nothing could be opened. */
export async function startCollage(files: File[]): Promise<void> {
  closeCollage();
  const list = files.slice(0, MAX_PHOTOS);
  patchCollage({ busy: true });
  try {
    const photos = await loadPhotos(list, list.length);
    const map: Record<string, CollagePhoto> = {};
    for (const p of photos) map[p.id] = p;
    checkpointDoc = null;
    patchCollage({
      photos: map,
      doc: { ...defaultCollageDoc(), cells: photos.map((p) => newCell(p.id)) },
      past: [],
      future: [],
      selected: null,
      swapping: false,
      tab: 'layout',
    });
  } finally {
    patchCollage({ busy: false });
  }
}

export async function addPhotos(files: File[]): Promise<void> {
  const room = MAX_PHOTOS - get().doc.cells.length;
  if (room <= 0) return;
  patchCollage({ busy: true });
  try {
    const photos = await loadPhotos(files.slice(0, room), get().doc.cells.length + Math.min(room, files.length));
    collage.set((s) => {
      const map = { ...s.photos };
      for (const p of photos) map[p.id] = p;
      return { ...s, photos: map };
    });
    applyDoc((d) => ({ ...d, layout: 0, cells: [...d.cells, ...photos.map((p) => newCell(p.id))] }));
  } finally {
    patchCollage({ busy: false });
  }
}

export async function replacePhoto(index: number, file: File): Promise<void> {
  patchCollage({ busy: true });
  try {
    const [photo] = await loadPhotos([file], get().doc.cells.length);
    collage.set((s) => ({ ...s, photos: { ...s.photos, [photo.id]: photo } }));
    applyDoc((d) => ({ ...d, cells: d.cells.map((c, i) => (i === index ? newCell(photo.id) : c)) }));
  } finally {
    patchCollage({ busy: false });
  }
}

export function removeCell(index: number): void {
  applyDoc((d) => ({ ...d, layout: 0, cells: d.cells.filter((_, i) => i !== index) }));
  patchCollage({ selected: null, swapping: false });
}

export function swapCells(a: number, b: number): void {
  if (a === b) return;
  applyDoc((d) => {
    const cells = d.cells.slice();
    // Swap the photos; positions reset because the cells may differ in shape.
    cells[a] = newCell(d.cells[b].photo);
    cells[b] = newCell(d.cells[a].photo);
    return { ...d, cells };
  });
}

/** Frees every photo. Photos stay alive across undo until the collage closes. */
export function closeCollage(): void {
  for (const p of Object.values(get().photos)) {
    releaseCanvas(p.image);
    releaseCanvas(p.proxy);
  }
  checkpointDoc = null;
  patchCollage({ photos: {}, doc: defaultCollageDoc(), past: [], future: [], selected: null, swapping: false });
}

export function previewImages(s: CollageState): Record<string, CollageImage> {
  const out: Record<string, CollageImage> = {};
  for (const p of Object.values(s.photos)) out[p.id] = { img: p.proxy, w: p.image.width, h: p.image.height };
  return out;
}

/** The finished collage at 2x social size, ready to finish in the editor. */
export function renderFinal(): HTMLCanvasElement {
  const s = get();
  const [W, H] = outputSize(ratioOf(s.doc), 'hd', 1, 1, 'fill', { zoom: 1, x: 0, y: 0, turns: 0, flip: false, straighten: 0 });
  const images: Record<string, CollageImage> = {};
  for (const p of Object.values(s.photos)) images[p.id] = { img: p.image, w: p.image.width, h: p.image.height };
  return renderCollage(W, H, s.doc, images);
}

// The editor: one photo and the edit made to it ("doc"), with undo history.
import { FILTERS, findFilter, neutralAdjustments, resolveLook, type AdjustKey, type Adjustments, type Look } from '../lib/adjust';
import type { Background } from '../lib/compose';
import { closeImage, decodeFile, fitWithin, resizeTo, type Decoded } from '../lib/image';
import { clampTransform, defaultTransform, frameRatio, type FitMode, type FormatId, type Transform } from '../lib/layout';
import { processor } from '../lib/processor';
import { createStore } from '../lib/store';
import type { TextLayer } from '../lib/text';

export interface Doc {
  format: FormatId;
  mode: FitMode;
  bg: Background;
  t: Transform;
  filter: string;
  /** 0..1 */
  strength: number;
  adjust: Adjustments;
  texts: TextLayer[];
}

export interface Photo {
  source: ImageBitmap | HTMLCanvasElement;
  width: number;
  height: number;
  /** Smaller copy used for the live preview. */
  proxy: HTMLCanvasElement;
  name: string;
  bytes: number;
}

export type Tool = 'frame' | 'filters' | 'adjust' | 'text';

export interface EditorState {
  photo: Photo | null;
  doc: Doc;
  past: Doc[];
  future: Doc[];
  tool: Tool;
  activeAdjust: AdjustKey;
  selected: string | null;
  editingText: string | null;
  comparing: boolean;
  exportOpen: boolean;
  /** Filter id -> thumbnail data URL. */
  thumbs: Record<string, string>;
}

export function defaultDoc(): Doc {
  return {
    format: 'portrait',
    mode: 'fill',
    bg: { kind: 'blur' },
    t: defaultTransform(),
    filter: 'none',
    strength: 1,
    adjust: neutralAdjustments(),
    texts: [],
  };
}

export const editor = createStore<EditorState>({
  photo: null,
  doc: defaultDoc(),
  past: [],
  future: [],
  tool: 'frame',
  activeAdjust: 'brightness',
  selected: null,
  editingText: null,
  comparing: false,
  exportOpen: false,
  thumbs: {},
});

export const get = () => editor.get();
export const patch = (p: Partial<EditorState>) => editor.set((s) => ({ ...s, ...p }));

// ------------------------------------------------------------------ history

let checkpointDoc: Doc | null = null;
const HISTORY_LIMIT = 60;

/** Call before a continuous change (drag, slider); `commit` records it as one step. */
export function checkpoint(): void {
  checkpointDoc ??= get().doc;
}

export function commit(): void {
  const base = checkpointDoc;
  checkpointDoc = null;
  if (!base) return;
  editor.set((s) =>
    JSON.stringify(base) === JSON.stringify(s.doc)
      ? s
      : { ...s, past: [...s.past, base].slice(-HISTORY_LIMIT), future: [] },
  );
}

/** Live change with no history entry (between checkpoint and commit). */
export function setDoc(update: (doc: Doc) => Doc): void {
  editor.set((s) => ({ ...s, doc: normalize(s, update(s.doc)) }));
}

/** A discrete change that is its own undo step. */
export function applyDoc(update: (doc: Doc) => Doc): void {
  checkpoint();
  setDoc(update);
  commit();
}

export function undo(): void {
  editor.set((s) => {
    if (!s.past.length) return s;
    return { ...s, doc: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.doc, ...s.future], selected: null };
  });
}

export function redo(): void {
  editor.set((s) => {
    if (!s.future.length) return s;
    return { ...s, doc: s.future[0], future: s.future.slice(1), past: [...s.past, s.doc], selected: null };
  });
}

/** Keeps the transform valid for the current frame shape. */
function normalize(s: EditorState, doc: Doc): Doc {
  if (!s.photo) return doc;
  const ratio = frameRatio(doc.format, s.photo.width, s.photo.height, doc.t.turns);
  const t = clampTransform(ratio, 1, s.photo.width, s.photo.height, doc.mode, doc.t);
  return t.x === doc.t.x && t.y === doc.t.y && t.zoom === doc.t.zoom ? doc : { ...doc, t };
}

export function isEdited(): boolean {
  return get().past.length > 0;
}

// ------------------------------------------------------------------ looks

export function lookOf(doc: Doc): Look {
  return resolveLook(findFilter(doc.filter), doc.strength, doc.adjust);
}

// ------------------------------------------------------------------ loading

const PROXY_EDGE = 2048;

function proxyEdge(): number {
  return Math.min(PROXY_EDGE, processor().maxSize);
}

export async function openFile(file: File): Promise<void> {
  const decoded = await decodeFile(file);
  setPhoto(decoded, file.name || 'photo', file.size);
}

export function openCanvas(canvas: HTMLCanvasElement, name: string, docPatch: Partial<Doc> = {}): void {
  setPhoto({ image: canvas, width: canvas.width, height: canvas.height }, name, 0, docPatch);
}

function setPhoto(decoded: Decoded, name: string, bytes: number, docPatch: Partial<Doc> = {}): void {
  closePhoto();
  const proxy = resizeTo(decoded.image, ...fitWithin(decoded.width, decoded.height, proxyEdge()));
  checkpointDoc = null;
  patch({
    photo: { source: decoded.image, width: decoded.width, height: decoded.height, proxy, name, bytes },
    doc: { ...defaultDoc(), ...docPatch },
    past: [],
    future: [],
    tool: docPatch.format === 'original' ? 'filters' : 'frame',
    selected: null,
    editingText: null,
    exportOpen: false,
    thumbs: {},
  });
  setTimeout(makeThumbs, 50);
}

export function closePhoto(): void {
  const photo = get().photo;
  if (!photo) return;
  processor().release();
  closeImage(photo.source);
  patch({ photo: null, thumbs: {}, past: [], future: [], doc: defaultDoc() });
}

function makeThumbs(): void {
  const photo = get().photo;
  if (!photo) return;
  // Square centre crop, small.
  const edge = 168;
  const k = edge / Math.min(photo.proxy.width, photo.proxy.height);
  const w = Math.round(photo.proxy.width * k);
  const h = Math.round(photo.proxy.height * k);
  const small = resizeTo(photo.proxy, w, h);
  const square = document.createElement('canvas');
  square.width = square.height = edge;
  const ctx = square.getContext('2d')!;
  const thumbs: Record<string, string> = {};
  for (const f of FILTERS) {
    const out = processor().process(small, w, h, resolveLook(f, 1, neutralAdjustments()));
    ctx.clearRect(0, 0, edge, edge);
    ctx.drawImage(out, (edge - w) / 2, (edge - h) / 2);
    thumbs[f.id] = square.toDataURL('image/jpeg', 0.82);
  }
  // The GPU now holds the thumbnail; the next preview draw re-uploads the proxy.
  processor().release();
  patch({ thumbs });
}

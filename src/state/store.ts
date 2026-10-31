import { useSyncExternalStore } from 'react';
import type { Analysis } from '../engine/Renderer';
import type { ExifSummary } from '../engine/metadata';
import { cloneParams, defaultParams, type EditParams } from '../engine/params';
import { FIT_VIEW, type ViewState } from '../engine/view';
import { DEFAULT_PRESET_ID, blendPreset, builtInPresets, sanitizeParams, type Preset } from '../presets/presets';

export type Compare = 'off' | 'side';
export type Module = 'library' | 'develop';
export type Flag = 'pick' | 'reject' | null;

export interface HistoryEntry {
  label: string;
  params: EditParams;
}

export interface Snapshot {
  id: string;
  name: string;
  params: EditParams;
}

/** One imported photo. Its edit state is parked here whenever another photo is active. */
export interface CatalogPhoto {
  id: string;
  name: string;
  /** Null for the generated sample scene. */
  file: File | null;
  width: number;
  height: number;
  thumb: string | null;
  rating: number;
  flag: Flag;
  exif: ExifSummary;
  /** Raw EXIF block from the file, carried into exports. */
  exifRaw: Uint8Array | null;
  params: EditParams;
  history: HistoryEntry[];
  historyIndex: number;
  snapshots: Snapshot[];
}

export interface StageSize {
  width: number;
  height: number;
  dpr: number;
}

export interface AppState {
  /** Live parameters. Replaced immutably, so reference equality means "unchanged". */
  params: EditParams;
  /** Every state of the active photo, oldest first. */
  history: HistoryEntry[];
  /** Which history entry `params` is at. Undo moves it; a new edit cuts what follows. */
  historyIndex: number;
  catalog: CatalogPhoto[];
  activeId: string | null;
  presets: Preset[];
  activePresetId: string | null;
  /** How strongly the active preset is applied, 0-100. */
  presetStrength: number;
  /** Changes whenever new pixels are on the GPU, for anything rendered from them. */
  imageToken: number;
  module: Module;
  compare: Compare;
  /** True while the original is being peeked at (long press). */
  peek: boolean;
  view: ViewState;
  stage: StageSize;
  tool: 'none' | 'crop' | 'whiteBalance';
  /** Crop aspect ratio lock (w/h), or null for free. */
  cropAspect: number | null;
  showClipping: boolean;
  analysis: Analysis | null;
  /** Colour under the pointer, 0-255. */
  readout: [number, number, number] | null;
  clipboard: EditParams | null;
  /** Hides side panels (Tab) and everything else (Shift+Tab). */
  hidePanels: boolean;
  hideChrome: boolean;
  /** 0 normal, 1 dimmed, 2 black. */
  lights: number;
  toast: { id: number; text: string; error: boolean } | null;
}

const STORAGE_KEY = 'pixelroom.presets.v1';
const HISTORY_LIMIT = 200;

function loadUserPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as { id: string; name: string; params: unknown }[];
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      builtIn: false,
      params: sanitizeParams(p.params),
    }));
  } catch {
    return [];
  }
}

function saveUserPresets(presets: Preset[]): boolean {
  try {
    const user = presets
      .filter((p) => !p.builtIn)
      .map(({ id, name, params }) => ({ id, name, params }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    return true;
  } catch {
    return false;
  }
}

let state: AppState = {
  params: defaultParams(),
  history: [],
  historyIndex: 0,
  catalog: [],
  activeId: null,
  presets: [...builtInPresets(), ...loadUserPresets()],
  activePresetId: null,
  presetStrength: 100,
  imageToken: 0,
  module: 'develop',
  compare: 'off',
  peek: false,
  view: FIT_VIEW,
  stage: { width: 1, height: 1, dpr: 1 },
  tool: 'none',
  cropAspect: null,
  showClipping: false,
  analysis: null,
  readout: null,
  clipboard: null,
  hidePanels: false,
  hideChrome: false,
  lights: 0,
  toast: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getState(): AppState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes a component to a slice; it re-renders only when the slice changes. */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export function activePhoto(s: AppState): CatalogPhoto | null {
  return s.catalog.find((p) => p.id === s.activeId) ?? null;
}

// -------------------------------------------------------------------- history

// The params as they were when the current gesture started; a whole slider drag
// becomes one history step instead of one per pointer move.
let gestureStart: EditParams | null = null;

function pushHistory(label: string, params: EditParams): Pick<AppState, 'history' | 'historyIndex'> {
  const kept = state.history.slice(0, state.historyIndex + 1);
  const history = [...kept, { label, params }].slice(-HISTORY_LIMIT);
  return { history, historyIndex: history.length - 1 };
}

/** Writes the active photo's working state back into its catalog entry. */
function parked(): CatalogPhoto[] {
  const { activeId, params, history, historyIndex } = state;
  return state.catalog.map((p) => (p.id === activeId ? { ...p, params, history, historyIndex } : p));
}

function updatePhoto(id: string, patch: Partial<CatalogPhoto>): void {
  setState({ catalog: state.catalog.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
}

let nextPhotoId = 1;

function withoutGeometry(source: EditParams, keep: EditParams): EditParams {
  return { ...cloneParams(source), geometry: { ...keep.geometry } };
}

export const actions = {
  /** Live update during a gesture. Call `commit()` when the gesture ends. */
  update(recipe: (draft: EditParams) => void): void {
    if (!gestureStart) gestureStart = state.params;
    const next = cloneParams(state.params);
    recipe(next);
    setState({ params: next, activePresetId: null });
  },

  commit(label = 'Edit'): void {
    if (!gestureStart) return;
    const start = gestureStart;
    gestureStart = null;
    if (JSON.stringify(start) === JSON.stringify(state.params)) return;
    setState(pushHistory(label, state.params));
  },

  /** A discrete change: one update plus one history step. */
  change(label: string, recipe: (draft: EditParams) => void): void {
    actions.update(recipe);
    actions.commit(label);
  },

  goToHistory(index: number): void {
    const entry = state.history[index];
    if (!entry) return;
    gestureStart = null;
    setState({ params: entry.params, historyIndex: index, activePresetId: null });
  },

  undo(): void {
    actions.goToHistory(state.historyIndex - 1);
  },

  redo(): void {
    actions.goToHistory(state.historyIndex + 1);
  },

  clearHistory(): void {
    const current = state.history[state.historyIndex];
    if (current) setState({ history: [current], historyIndex: 0 });
  },

  reset(): void {
    actions.applyParams(defaultParams(), null, 'Reset Settings');
  },

  applyParams(params: EditParams, presetId: string | null, label: string): void {
    const next = cloneParams(params);
    setState({ ...pushHistory(label, next), params: next, activePresetId: presetId });
  },

  /** A preset is a look: it changes tone and colour, never the framing. */
  applyPreset(id: string): void {
    const preset = state.presets.find((p) => p.id === id);
    if (!preset) return;
    actions.applyParams(withoutGeometry(preset.params, state.params), id, `Preset: ${preset.name}`);
    setState({ presetStrength: 100 });
  },

  /** Live, like `update`, but the preset stays selected. Call `commit()` when done. */
  setPresetStrength(value: number): void {
    const preset = state.presets.find((p) => p.id === state.activePresetId);
    if (!preset) return;
    if (!gestureStart) gestureStart = state.params;
    setState({ params: blendPreset(preset.params, value / 100, state.params.geometry), presetStrength: value });
  },

  imageLoaded(): void {
    setState({ imageToken: state.imageToken + 1 });
  },

  addPreset(name: string, params: EditParams): Preset {
    const preset: Preset = {
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      builtIn: false,
      params: cloneParams(params),
    };
    const presets = [...state.presets, preset];
    setState({ presets });
    if (!saveUserPresets(presets)) {
      actions.notify('Preset kept for this session only: browser storage is unavailable.', true);
    }
    return preset;
  },

  saveCurrentAsPreset(name: string): void {
    const preset = actions.addPreset(name, state.params);
    setState({ activePresetId: preset.id });
  },

  deletePreset(id: string): void {
    const presets = state.presets.filter((p) => p.id !== id || p.builtIn);
    setState({
      presets,
      activePresetId: state.activePresetId === id ? null : state.activePresetId,
    });
    saveUserPresets(presets);
  },

  // ------------------------------------------------------------------ snapshots

  addSnapshot(name: string): void {
    const photo = activePhoto(state);
    if (!photo) return;
    const snapshot: Snapshot = {
      id: `snap-${Date.now().toString(36)}`,
      name,
      params: cloneParams(state.params),
    };
    updatePhoto(photo.id, { snapshots: [...photo.snapshots, snapshot] });
  },

  applySnapshot(id: string): void {
    const snapshot = activePhoto(state)?.snapshots.find((s) => s.id === id);
    if (snapshot) actions.applyParams(snapshot.params, null, `Snapshot: ${snapshot.name}`);
  },

  deleteSnapshot(id: string): void {
    const photo = activePhoto(state);
    if (photo) updatePhoto(photo.id, { snapshots: photo.snapshots.filter((s) => s.id !== id) });
  },

  // ------------------------------------------------------------------ copy/paste

  copySettings(): void {
    setState({ clipboard: cloneParams(state.params) });
    actions.notify('Settings copied.');
  },

  pasteSettings(): void {
    if (state.clipboard) {
      actions.applyParams(withoutGeometry(state.clipboard, state.params), null, 'Paste Settings');
    }
  },

  /** Applies the settings of the photo before this one in the filmstrip. */
  pastePrevious(): void {
    const index = state.catalog.findIndex((p) => p.id === state.activeId);
    const previous = state.catalog[index - 1];
    if (previous) actions.applyParams(withoutGeometry(previous.params, state.params), null, `Settings from ${previous.name}`);
  },

  // -------------------------------------------------------------------- catalog

  /** A new photo starts a clean history at its default settings. */
  addPhoto(info: Pick<CatalogPhoto, 'name' | 'file' | 'width' | 'height' | 'exif' | 'exifRaw'>): string {
    const preset = state.presets.find((p) => p.id === DEFAULT_PRESET_ID);
    const params = cloneParams(preset ? preset.params : defaultParams());
    const id = `photo-${nextPhotoId++}`;
    const photo: CatalogPhoto = {
      ...info,
      id,
      thumb: null,
      rating: 0,
      flag: null,
      params,
      history: [{ label: `Import (${new Date().toLocaleDateString()})`, params }],
      historyIndex: 0,
      snapshots: [],
    };
    setState({ catalog: [...parked(), photo] });
    return id;
  },

  /** Switches the working state over to a photo. The caller loads its pixels. */
  activatePhoto(id: string): void {
    const catalog = parked();
    const photo = catalog.find((p) => p.id === id);
    if (!photo) return;
    gestureStart = null;
    setState({
      catalog,
      activeId: id,
      params: photo.params,
      history: photo.history,
      historyIndex: photo.historyIndex,
      activePresetId: null,
      compare: 'off',
      peek: false,
      view: FIT_VIEW,
      tool: 'none',
      analysis: null,
      readout: null,
    });
  },

  removePhoto(id: string): void {
    setState({
      catalog: state.catalog.filter((p) => p.id !== id),
      ...(state.activeId === id ? { activeId: null } : {}),
    });
  },

  setThumb(id: string, thumb: string): void {
    updatePhoto(id, { thumb });
  },

  setRating(rating: number): void {
    if (state.activeId) updatePhoto(state.activeId, { rating });
  },

  setFlag(flag: Flag): void {
    if (state.activeId) updatePhoto(state.activeId, { flag });
  },

  // ------------------------------------------------------------------------- UI

  setModule(module: Module): void {
    setState({ module, tool: 'none' });
  },

  setView(view: ViewState): void {
    setState({ view });
  },

  setStage(stage: StageSize): void {
    const s = state.stage;
    if (s.width !== stage.width || s.height !== stage.height || s.dpr !== stage.dpr) setState({ stage });
  },

  setTool(tool: AppState['tool']): void {
    // Framing needs the whole picture in view.
    setState({ tool, ...(tool === 'crop' ? { view: FIT_VIEW, compare: 'off' as const } : {}) });
  },

  setCropAspect(cropAspect: number | null): void {
    setState({ cropAspect });
  },

  toggleClipping(): void {
    setState({ showClipping: !state.showClipping });
  },

  setAnalysis(analysis: Analysis | null): void {
    setState({ analysis });
  },

  setReadout(readout: [number, number, number] | null): void {
    setState({ readout });
  },

  toggleCompare(): void {
    setState({ compare: state.compare === 'off' ? 'side' : 'off', tool: 'none' });
  },

  setPeek(peek: boolean): void {
    if (state.peek !== peek) setState({ peek });
  },

  togglePanels(): void {
    setState({ hidePanels: !state.hidePanels });
  },

  toggleChrome(): void {
    setState({ hideChrome: !state.hideChrome });
  },

  cycleLights(): void {
    setState({ lights: (state.lights + 1) % 3 });
  },

  notify(text: string, error = false): void {
    setState({ toast: { id: Date.now(), text, error } });
  },

  dismissToast(): void {
    setState({ toast: null });
  },
};

import { useSyncExternalStore } from 'react';
import { cloneParams, defaultParams, type EditParams } from '../engine/params';
import { DEFAULT_PRESET_ID, builtInPresets, sanitizeParams, type Preset } from '../presets/presets';

export type Compare = 'off' | 'side';

export interface PhotoInfo {
  name: string;
  width: number;
  height: number;
}

export interface AppState {
  /** Live parameters. Replaced immutably, so reference equality means "unchanged". */
  params: EditParams;
  past: EditParams[];
  future: EditParams[];
  presets: Preset[];
  activePresetId: string | null;
  photo: PhotoInfo | null;
  compare: Compare;
  /** True while the original is being peeked at (long press). */
  peek: boolean;
  toast: { id: number; text: string; error: boolean } | null;
}

const STORAGE_KEY = 'pixelroom.presets.v1';
const HISTORY_LIMIT = 100;

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
  past: [],
  future: [],
  presets: [...builtInPresets(), ...loadUserPresets()],
  activePresetId: null,
  photo: null,
  compare: 'off',
  peek: false,
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

// -------------------------------------------------------------------- history

// The params as they were when the current gesture started; a whole slider drag
// becomes one undo step instead of one per pointer move.
let gestureStart: EditParams | null = null;

function pushHistory(previous: EditParams): Pick<AppState, 'past' | 'future'> {
  return { past: [...state.past, previous].slice(-HISTORY_LIMIT), future: [] };
}

export const actions = {
  /** Live update during a gesture. Call `commit()` when the gesture ends. */
  update(recipe: (draft: EditParams) => void): void {
    if (!gestureStart) gestureStart = state.params;
    const next = cloneParams(state.params);
    recipe(next);
    setState({ params: next, activePresetId: null });
  },

  commit(): void {
    if (!gestureStart) return;
    const start = gestureStart;
    gestureStart = null;
    if (JSON.stringify(start) === JSON.stringify(state.params)) return;
    setState(pushHistory(start));
  },

  /** A discrete change: one update plus one undo step. */
  change(recipe: (draft: EditParams) => void): void {
    actions.update(recipe);
    actions.commit();
  },

  undo(): void {
    const { past, future, params } = state;
    if (!past.length) return;
    setState({
      params: past[past.length - 1],
      past: past.slice(0, -1),
      future: [params, ...future],
      activePresetId: null,
    });
  },

  redo(): void {
    const { past, future, params } = state;
    if (!future.length) return;
    setState({
      params: future[0],
      future: future.slice(1),
      past: [...past, params],
      activePresetId: null,
    });
  },

  reset(): void {
    actions.applyParams(defaultParams(), null);
  },

  applyParams(params: EditParams, presetId: string | null): void {
    setState({ ...pushHistory(state.params), params: cloneParams(params), activePresetId: presetId });
  },

  applyPreset(id: string): void {
    const preset = state.presets.find((p) => p.id === id);
    if (preset) actions.applyParams(preset.params, id);
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

  /** A new photo starts a clean history with the default preset applied. */
  openPhoto(photo: PhotoInfo): void {
    const preset = state.presets.find((p) => p.id === DEFAULT_PRESET_ID);
    gestureStart = null;
    setState({
      photo,
      params: cloneParams(preset ? preset.params : defaultParams()),
      activePresetId: preset ? preset.id : null,
      past: [],
      future: [],
      compare: 'off',
      peek: false,
    });
  },

  toggleCompare(): void {
    setState({ compare: state.compare === 'off' ? 'side' : 'off' });
  },

  setPeek(peek: boolean): void {
    if (state.peek !== peek) setState({ peek });
  },

  notify(text: string, error = false): void {
    setState({ toast: { id: Date.now(), text, error } });
  },

  dismissToast(): void {
    setState({ toast: null });
  },
};

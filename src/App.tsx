import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ExportDialog } from './components/ExportDialog';
import {
  ChevronIcon,
  CompareIcon,
  ExportIcon,
  OpenIcon,
  RedoIcon,
  ResetIcon,
  UndoIcon,
} from './components/Icons';
import { SECTIONS } from './components/panels';
import { useMediaQuery } from './components/Slider';
import { Viewer } from './components/Viewer';
import { openFile } from './state/editor';
import { actions, useStore } from './state/store';

const COMPACT_QUERY = '(max-width: 899px) and (min-height: 501px)';
const LONG_PRESS_MS = 350;

/** Tap: toggle side by side. Long press: peek at the original while held. */
function CompareButton() {
  const compare = useStore((s) => s.compare);
  const disabled = useStore((s) => !s.photo);
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  const release = () => {
    window.clearTimeout(timer.current);
    actions.setPeek(false);
  };

  return (
    <button
      className={`icon-button labelled${compare === 'side' ? ' on' : ''}`}
      disabled={disabled}
      aria-pressed={compare === 'side'}
      title="Tap for side by side. Hold to see the original. (Y, or hold \)"
      onPointerDown={() => {
        longPressed.current = false;
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          actions.setPeek(true);
        }, LONG_PRESS_MS);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (!longPressed.current) actions.toggleCompare();
        longPressed.current = false;
      }}
    >
      <CompareIcon />
      <span>Before / After</span>
    </button>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(actions.dismissToast, toast.error ? 7000 : 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast${toast.error ? ' error' : ''}`} role={toast.error ? 'alert' : 'status'}>
      {toast.text}
    </div>
  );
}

function DesktopPanels() {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.id, !!s.defaultOpen])),
  );
  return (
    <aside className="side-panel" aria-label="Adjustments">
      {SECTIONS.map(({ id, title, Panel }) => (
        <section key={id} className={`accordion${open[id] ? ' open' : ''}`}>
          <button
            className="accordion-head"
            aria-expanded={!!open[id]}
            onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
          >
            {title}
            <ChevronIcon />
          </button>
          {open[id] && (
            <div className="accordion-body">
              <Panel />
            </div>
          )}
        </section>
      ))}
    </aside>
  );
}

function CompactPanels() {
  const [active, setActive] = useState<string | null>('presets');
  const section = SECTIONS.find((s) => s.id === active);
  return (
    <div className="bottom-tools">
      {section && (
        <div className="sheet" aria-label={section.title}>
          <section.Panel />
        </div>
      )}
      <nav className="tool-tabs" aria-label="Adjustment groups">
        {SECTIONS.map(({ id, shortTitle, Icon }) => (
          <button
            key={id}
            className={id === active ? 'active' : ''}
            aria-pressed={id === active}
            onClick={() => setActive((current) => (current === id ? null : id))}
          >
            <Icon />
            <span>{shortTitle}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  const compact = useMediaQuery(COMPACT_QUERY);
  const photo = useStore((s) => s.photo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback(() => fileRef.current?.click(), []);
  const closeExport = useCallback(() => setExporting(false), []);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void openFile(file);
  };

  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        actions.redo();
      } else if (!mod && key === 'y') {
        actions.toggleCompare();
      } else if (!mod && e.key === '\\') {
        actions.setPeek(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === '\\') actions.setPeek(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div className={`app${compact ? ' compact' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span className="brand-name">PixelRoom</span>
        </div>
        {photo && (
          <div className="photo-info">
            {photo.name} · {photo.width} × {photo.height}
          </div>
        )}
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Open photo" title="Open photo" onClick={pickFile}>
            <OpenIcon />
          </button>
          <button className="icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={actions.undo}>
            <UndoIcon />
          </button>
          <button className="icon-button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={actions.redo}>
            <RedoIcon />
          </button>
          <button className="icon-button" aria-label="Reset all adjustments" title="Reset all" disabled={!photo} onClick={actions.reset}>
            <ResetIcon />
          </button>
          <CompareButton />
          <button className="button primary export-button" disabled={!photo} onClick={() => setExporting(true)}>
            <ExportIcon />
            <span>Export</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <Viewer onOpenClick={pickFile} />
        {compact ? <CompactPanels /> : <DesktopPanels />}
      </main>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {exporting && <ExportDialog onClose={closeExport} />}
      <Toast />
    </div>
  );
}

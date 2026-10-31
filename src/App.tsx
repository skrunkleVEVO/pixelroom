import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ComponentType, type ReactNode } from 'react';
import { ExportDialog } from './components/ExportDialog';
import { ChevronIcon, CompareIcon, OpenIcon, RedoIcon, UndoIcon } from './components/Icons';
import { MobileTools, QuickExport } from './components/MobileTools';
import { LEFT_SECTIONS, RIGHT_SECTIONS, type Section } from './components/panels';
import { useMediaQuery } from './components/Slider';
import { Viewer } from './components/Viewer';
import { Filmstrip, Histogram, LibraryGrid, LibraryInfo, Navigator, ToolStrip, Toolbar } from './components/Workspace';
import { importFiles, stepPhoto } from './state/editor';
import { actions, getState, useStore, type Module } from './state/store';

const COMPACT_QUERY = '(max-width: 899px), (max-height: 500px)';

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

function Panel({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className={`panel${open ? ' open' : ''}`}>
      <button className="panel-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="panel-title">{title}</span>
        <ChevronIcon />
      </button>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}

function PanelStack({ sections }: { sections: Section[] }) {
  return (
    <>
      {sections.map(({ id, title, Panel: Body, defaultOpen }: { id: string; title: string; Panel: ComponentType; defaultOpen?: boolean }) => (
        <Panel key={id} title={title} defaultOpen={defaultOpen}>
          <Body />
        </Panel>
      ))}
    </>
  );
}

const MODULES: { id: Module; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'develop', label: 'Develop' },
];

export function App() {
  const compact = useMediaQuery(COMPACT_QUERY);
  const module = useStore((s) => s.module);
  const hasPhoto = useStore((s) => s.activeId !== null);
  const canUndo = useStore((s) => s.historyIndex > 0);
  const canRedo = useStore((s) => s.historyIndex < s.history.length - 1);
  const canPaste = useStore((s) => s.clipboard !== null);
  const canPrevious = useStore((s) => s.catalog.findIndex((p) => p.id === s.activeId) > 0);
  const hidePanels = useStore((s) => s.hidePanels);
  const hideChrome = useStore((s) => s.hideChrome);
  const lights = useStore((s) => s.lights);
  const [exporting, setExporting] = useState(false);
  const [quickExport, setQuickExport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback(() => fileRef.current?.click(), []);
  const closeExport = useCallback(() => setExporting(false), []);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) void importFiles(files);
  };

  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const photo = getState().activeId !== null;

      if (mod) {
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) actions.redo();
          else actions.undo();
        } else if (key === 'y') {
          e.preventDefault();
          actions.redo();
        } else if (key === 'e' && e.shiftKey && photo) {
          e.preventDefault();
          setExporting(true);
        } else if (key === 'i' && e.shiftKey) {
          e.preventDefault();
          pickFile();
        } else if (key === 'c' && e.shiftKey && photo) {
          e.preventDefault();
          actions.copySettings();
        } else if (key === 'v' && e.shiftKey && photo) {
          e.preventDefault();
          actions.pasteSettings();
        }
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) actions.toggleChrome();
        else actions.togglePanels();
      } else if (key === 'g') {
        actions.setModule('library');
      } else if (key === 'd' || key === 'e') {
        actions.setModule('develop');
      } else if (key === 'l') {
        actions.cycleLights();
      } else if (key === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepPhoto(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepPhoto(1);
      } else if (!photo) {
        return;
      } else if (key === 'y') {
        actions.toggleCompare();
      } else if (e.key === '\\') {
        actions.setPeek(true);
      } else if (key === 'r' || key === 'w') {
        // Read the tool first: changing module closes any open tool.
        const tool = key === 'r' ? 'crop' : 'whiteBalance';
        const next = getState().tool === tool ? 'none' : tool;
        actions.setModule('develop');
        actions.setTool(next);
      } else if (key === 'j') {
        actions.toggleClipping();
      } else if (key === 'z') {
        const { view } = getState();
        actions.setView({ ...view, zoom: view.zoom === 'fit' ? 1 : 'fit' });
      } else if (key === 'p') {
        actions.setFlag('pick');
      } else if (key === 'x') {
        actions.setFlag('reject');
      } else if (key === 'u') {
        actions.setFlag(null);
      } else if (/^[0-5]$/.test(key)) {
        actions.setRating(Number(key));
      } else if (e.key === 'Escape' && getState().tool !== 'none') {
        actions.setTool('none');
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
  }, [pickFile]);

  const appClass = ['app', compact ? 'compact' : '', hidePanels ? 'hide-panels' : '', hideChrome ? 'hide-chrome' : '', `lights-${lights}`]
    .filter(Boolean)
    .join(' ');
  const library = module === 'library' && !compact;

  return (
    <div className={appClass}>
      <header className="topbar">
        <div className="brand">PixelRoom</div>
        {compact ? (
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Import photos" title="Import photos" onClick={pickFile}>
              <OpenIcon />
            </button>
            <button className="icon-button" aria-label="Undo" disabled={!canUndo} onClick={actions.undo}>
              <UndoIcon />
            </button>
            <button className="icon-button" aria-label="Redo" disabled={!canRedo} onClick={actions.redo}>
              <RedoIcon />
            </button>
            <button
              className="icon-button"
              aria-label="Hold to see the original"
              disabled={!hasPhoto}
              onPointerDown={() => actions.setPeek(true)}
              onPointerUp={() => actions.setPeek(false)}
              onPointerLeave={() => actions.setPeek(false)}
              onPointerCancel={() => actions.setPeek(false)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <CompareIcon />
            </button>
            <button className="export-pill" disabled={!hasPhoto} onClick={() => setQuickExport(true)}>
              Export
            </button>
          </div>
        ) : (
          <nav className="modules" aria-label="Modules">
            {MODULES.map((m, i) => (
              <span key={m.id}>
                {i > 0 && <span className="module-sep">|</span>}
                <button className={module === m.id ? 'on' : ''} aria-current={module === m.id} onClick={() => actions.setModule(m.id)}>
                  {m.label}
                </button>
              </span>
            ))}
          </nav>
        )}
      </header>

      <main className="workspace">
        {!compact && (
          <aside className="side left" aria-label="Photo navigation">
            <div className="side-scroll">
              <Navigator />
              {!library && <PanelStack sections={LEFT_SECTIONS} />}
            </div>
            <div className="side-foot">
              <button className="flat-button grow" onClick={pickFile} title="Import (Ctrl+Shift+I)">
                Import...
              </button>
              <button className="flat-button grow" disabled={!hasPhoto} onClick={() => setExporting(true)} title="Export (Ctrl+Shift+E)">
                Export...
              </button>
            </div>
          </aside>
        )}

        <div className="center">
          {library && <LibraryGrid />}
          {/* Stays mounted in Library so the GL context and the open photo survive. */}
          <div className={`viewer-wrap${library ? ' hidden' : ''}`}>
            <Viewer onOpenClick={pickFile} />
          </div>
          {!compact && <Toolbar />}
        </div>

        {compact && hasPhoto && <MobileTools />}
        {!compact && (
          <aside className="side right" aria-label="Adjustments">
            <div className="side-scroll">
              <Histogram />
              {library && <Panel title="Metadata" defaultOpen><LibraryInfo /></Panel>}
              {!library && (
                <>
                  <ToolStrip />
                  <PanelStack sections={RIGHT_SECTIONS} />
                </>
              )}
            </div>
            {!library && (
              <div className="side-foot">
                <button className="flat-button grow" disabled={!hasPhoto} onClick={actions.copySettings} title="Copy settings (Ctrl+Shift+C)">
                  Copy...
                </button>
                <button className="flat-button grow" disabled={!canPaste} onClick={actions.pasteSettings} title="Paste settings (Ctrl+Shift+V)">
                  Paste
                </button>
                <button className="flat-button grow" disabled={!canPrevious} onClick={actions.pastePrevious} title="Apply the previous photo's settings">
                  Previous
                </button>
                <button className="flat-button grow" disabled={!hasPhoto} onClick={actions.reset} title="Reset all settings">
                  Reset
                </button>
              </div>
            )}
          </aside>
        )}
      </main>

      {!compact && <Filmstrip />}

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFile} />
      {exporting && <ExportDialog onClose={closeExport} />}
      {quickExport && (
        <QuickExport
          onClose={() => setQuickExport(false)}
          onMore={() => {
            setQuickExport(false);
            setExporting(true);
          }}
        />
      )}
      <Toast />
    </div>
  );
}

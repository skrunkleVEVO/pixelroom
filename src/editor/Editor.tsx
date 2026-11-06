import { useEffect, type ComponentType } from 'react';
import { useStore } from '../lib/store';
import * as I from '../ui/Icons';
import { ExportSheet } from './ExportSheet';
import { Stage } from './Stage';
import { TextEditor } from './TextEditor';
import { AdjustTool, FilterTool, FrameTool, TextTool, addText } from './Tools';
import { applyDoc, editor, get, isEdited, patch, redo, undo, type Tool } from './state';

const TOOLS: { id: Tool; label: string; icon: ComponentType<{ size?: number }>; panel: ComponentType }[] = [
  { id: 'frame', label: 'Frame', icon: I.Frame, panel: FrameTool },
  { id: 'filters', label: 'Filters', icon: I.Filters, panel: FilterTool },
  { id: 'adjust', label: 'Adjust', icon: I.Sliders, panel: AdjustTool },
  { id: 'text', label: 'Text', icon: I.TextIcon, panel: TextTool },
];

export function Editor({ onClose }: { onClose: () => void }) {
  const tool = useStore(editor, (s) => s.tool);
  const canUndo = useStore(editor, (s) => s.past.length > 0);
  const canRedo = useStore(editor, (s) => s.future.length > 0);
  const editingText = useStore(editor, (s) => s.editingText);
  const exportOpen = useStore(editor, (s) => s.exportOpen);
  const comparing = useStore(editor, (s) => s.comparing);
  const Panel = TOOLS.find((t) => t.id === tool)!.panel;

  const back = () => {
    if (isEdited() && !confirm('Discard your edits to this photo?')) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = get();
      if (s.editingText || s.exportOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        patch({ exportOpen: true });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected) {
        const id = s.selected;
        applyDoc((d) => ({ ...d, texts: d.texts.filter((l) => l.id !== id) }));
        patch({ selected: null });
      } else if (e.key === 't' && !mod) {
        addText();
      }
    };
    // Leaving with unsaved work by accident is the worst outcome on a phone.
    const onLeave = (e: BeforeUnloadEvent) => {
      if (isEdited()) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, []);

  const hold = (on: boolean) => () => patch({ comparing: on });

  return (
    <div className="editor">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={back}>
          <I.Back />
        </button>
        <div className="topbar-mid">
          <button className="icon-btn" aria-label="Undo" disabled={!canUndo} onClick={undo}>
            <I.Undo />
          </button>
          <button className="icon-btn" aria-label="Redo" disabled={!canRedo} onClick={redo}>
            <I.Redo />
          </button>
          <button
            className={comparing ? 'icon-btn is-on' : 'icon-btn'}
            aria-label="Hold to see the original"
            title="Hold to see the original"
            onPointerDown={hold(true)}
            onPointerUp={hold(false)}
            onPointerLeave={hold(false)}
            onPointerCancel={hold(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <I.Compare />
          </button>
        </div>
        <button className="btn btn-primary btn-small" onClick={() => patch({ exportOpen: true, selected: null })}>
          Save
        </button>
      </header>

      <main className="editor-main">
        <Stage />
        <section className="panel" aria-label={TOOLS.find((t) => t.id === tool)!.label}>
          <Panel />
        </section>
      </main>

      <nav className="tabs" aria-label="Tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'tab is-on' : 'tab'}
            aria-current={tool === t.id}
            onClick={() => patch({ tool: t.id, selected: t.id === 'text' ? get().selected : null })}
          >
            <t.icon size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {editingText && <TextEditor key={editingText} id={editingText} />}
      {exportOpen && <ExportSheet />}
    </div>
  );
}

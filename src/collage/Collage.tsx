import { useRef, useState } from 'react';
import { MAX_PHOTOS, MIN_PHOTOS, layoutsFor, type Rect } from '../lib/collage';
import { FORMATS } from '../lib/layout';
import { useStore } from '../lib/store';
import * as I from '../ui/Icons';
import { Slider } from '../ui/Slider';
import { CollageStage } from './CollageStage';
import {
  addPhotos,
  applyDoc,
  checkpoint,
  collage,
  commit,
  patchCollage,
  redo,
  removeCell,
  renderFinal,
  replacePhoto,
  setDoc,
  undo,
} from './state';

const BG_COLORS = ['#ffffff', '#000000', '#f4ede4', '#1c1c1e', '#ffd6e0', '#cfe8ff', '#d9f2d0', '#ffe9a8'];
const COLLAGE_FORMATS = FORMATS.filter((f) => f.ratio !== null);

interface Props {
  onBack: () => void;
  onNext: (canvas: HTMLCanvasElement) => void;
}

export function Collage({ onBack, onNext }: Props) {
  const tab = useStore(collage, (s) => s.tab);
  const canUndo = useStore(collage, (s) => s.past.length > 0);
  const canRedo = useStore(collage, (s) => s.future.length > 0);
  const selected = useStore(collage, (s) => s.selected);
  const swapping = useStore(collage, (s) => s.swapping);
  const count = useStore(collage, (s) => s.doc.cells.length);
  const busy = useStore(collage, (s) => s.busy);
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = (p: Promise<void>) =>
    p.catch((e) => setError(e instanceof Error ? e.message : "That photo couldn't be opened."));

  const back = () => {
    if (collage.get().past.length && !confirm('Discard this collage?')) return;
    onBack();
  };

  const next = () => {
    patchCollage({ selected: null, swapping: false });
    try {
      onNext(renderFinal());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rendering failed.');
    }
  };

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
        </div>
        <button className="btn btn-primary btn-small" onClick={next} disabled={busy}>
          Next
        </button>
      </header>

      <main className="editor-main">
        <CollageStage />
        <section className="panel" aria-label="Collage">
          {error && (
            <p className="error-banner small" role="alert" onClick={() => setError(null)}>
              {error}
            </p>
          )}
          {selected !== null ? (
            <div className="tool">
              <div className="row cell-actions">
                <button
                  className={swapping ? 'btn btn-small is-swapping' : 'btn btn-small'}
                  onClick={() => patchCollage({ swapping: !swapping })}
                >
                  <I.Swap size={18} /> {swapping ? 'Tap a photo' : 'Swap'}
                </button>
                <button className="btn btn-small" onClick={() => replaceInput.current?.click()}>
                  <I.ImageIcon size={18} /> Replace
                </button>
                <button
                  className="btn btn-small danger-text"
                  disabled={count <= MIN_PHOTOS}
                  onClick={() => removeCell(selected)}
                >
                  <I.Trash size={18} /> Remove
                </button>
                <button
                  className="icon-btn"
                  aria-label="Done"
                  onClick={() => patchCollage({ selected: null, swapping: false })}
                >
                  <I.Check />
                </button>
              </div>
              <p className="hint">
                {swapping
                  ? 'Tap another photo to trade places.'
                  : 'Drag to move · pinch to zoom · tap ✓ when done.'}
              </p>
            </div>
          ) : tab === 'layout' ? (
            <LayoutTool onAdd={() => addInput.current?.click()} />
          ) : (
            <StyleTool />
          )}
          {busy && <div className="panel-busy"><div className="spinner small" /> Loading photos…</div>}
        </section>
      </main>

      <nav className="tabs" aria-label="Collage tools">
        <button
          className={tab === 'layout' && selected === null ? 'tab is-on' : 'tab'}
          onClick={() => patchCollage({ tab: 'layout', selected: null, swapping: false })}
        >
          <I.Grid size={22} />
          <span>Layout</span>
        </button>
        <button
          className={tab === 'style' && selected === null ? 'tab is-on' : 'tab'}
          onClick={() => patchCollage({ tab: 'style', selected: null, swapping: false })}
        >
          <I.Sliders size={22} />
          <span>Style</span>
        </button>
      </nav>

      <input
        ref={addInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void guard(addPhotos(files));
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          const idx = collage.get().selected;
          if (file && idx !== null) void guard(replacePhoto(idx, file));
        }}
      />
    </div>
  );
}

function LayoutTool({ onAdd }: { onAdd: () => void }) {
  const doc = useStore(collage, (s) => s.doc);
  const layouts = layoutsFor(doc.cells.length);
  return (
    <div className="tool">
      <div className="chips">
        {COLLAGE_FORMATS.map((f) => (
          <button
            key={f.id}
            className={doc.format === f.id ? 'chip is-on' : 'chip'}
            onClick={() => applyDoc((d) => ({ ...d, format: f.id }))}
          >
            {f.label} <small className="chip-hint">{f.hint}</small>
          </button>
        ))}
      </div>
      <div className="layouts">
        {layouts.map((rects, i) => (
          <button
            key={i}
            className={doc.layout === i ? 'layout is-on' : 'layout'}
            aria-label={`Layout ${i + 1}`}
            aria-pressed={doc.layout === i}
            onClick={() => applyDoc((d) => ({ ...d, layout: i }))}
          >
            <LayoutIcon rects={rects} />
          </button>
        ))}
        {doc.cells.length < MAX_PHOTOS && (
          <button className="layout layout-add" aria-label="Add photos" onClick={onAdd}>
            <I.Plus />
          </button>
        )}
      </div>
      <p className="hint">
        {doc.cells.length} photos · tap a photo to move, swap or replace it.
      </p>
    </div>
  );
}

function LayoutIcon({ rects }: { rects: Rect[] }) {
  const g = 2.5;
  return (
    <svg viewBox="0 0 40 50" width="34" height="42" aria-hidden="true">
      {rects.map(([x, y, w, h], i) => (
        <rect
          key={i}
          x={x * 40 + g / 2}
          y={y * 50 + g / 2}
          width={Math.max(1, w * 40 - g)}
          height={Math.max(1, h * 50 - g)}
          rx="2"
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

function StyleTool() {
  const doc = useStore(collage, (s) => s.doc);
  return (
    <div className="tool">
      <Slider
        label="Spacing"
        min={0}
        max={100}
        defaultValue={20}
        value={doc.gap}
        onStart={checkpoint}
        onEnd={commit}
        onChange={(v) => setDoc((d) => ({ ...d, gap: v }))}
      />
      <Slider
        label="Rounded corners"
        min={0}
        max={100}
        value={doc.radius}
        onStart={checkpoint}
        onEnd={commit}
        onChange={(v) => setDoc((d) => ({ ...d, radius: v }))}
      />
      <div className="swatches" aria-label="Background">
        {BG_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Background ${c}`}
            className={doc.bg === c ? 'swatch is-on' : 'swatch'}
            style={{ background: c }}
            onClick={() => applyDoc((d) => ({ ...d, bg: c }))}
          />
        ))}
        <label className="swatch swatch-custom" aria-label="Custom background colour">
          <input
            type="color"
            value={doc.bg}
            onFocus={checkpoint}
            onChange={(e) => setDoc((d) => ({ ...d, bg: e.target.value }))}
            onBlur={commit}
          />
        </label>
      </div>
    </div>
  );
}

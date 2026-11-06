// The bottom panels: Frame, Filters, Adjust and Text.
import { ADJUSTMENTS, FILTERS, adjustInfo, autoEnhance, neutralAdjustments } from '../lib/adjust';
import { samplePixels } from '../lib/image';
import { FORMATS, defaultTransform } from '../lib/layout';
import { useStore } from '../lib/store';
import { newTextLayer } from '../lib/text';
import * as I from '../ui/Icons';
import { Slider } from '../ui/Slider';
import { applyDoc, checkpoint, commit, editor, get, patch, setDoc } from './state';

const BG_COLORS = ['#ffffff', '#000000', '#f4ede4', '#1c1c1e', '#ffd6e0', '#cfe8ff', '#d9f2d0', '#ffe9a8'];

export function FrameTool() {
  const doc = useStore(editor, (s) => s.doc);
  const fit = doc.mode === 'fit';
  return (
    <div className="tool">
      <div className="chips" role="radiogroup" aria-label="Format">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={doc.format === f.id}
            className={doc.format === f.id ? 'format is-on' : 'format'}
            onClick={() => applyDoc((d) => ({ ...d, format: f.id, t: { ...d.t, x: 0, y: 0, zoom: 1 } }))}
          >
            <FormatShape ratio={f.ratio} />
            <strong>{f.label}</strong>
            <small>{f.hint}</small>
          </button>
        ))}
      </div>

      <div className="row">
        <div className="segmented" role="radiogroup" aria-label="Photo fit">
          {(['fill', 'fit'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={doc.mode === m}
              aria-label={m === 'fill' ? 'Crop to fill the frame' : 'Fit the whole photo'}
              className={doc.mode === m ? 'is-on' : ''}
              onClick={() => applyDoc((d) => ({ ...d, mode: m, t: { ...d.t, x: 0, y: 0, zoom: 1 } }))}
            >
              {m === 'fill' ? 'Fill' : 'Fit'}
            </button>
          ))}
        </div>
        <button className="icon-btn" aria-label="Rotate" onClick={() => applyDoc((d) => ({ ...d, t: { ...d.t, turns: (d.t.turns + 1) % 4, x: 0, y: 0 } }))}>
          <I.Rotate />
        </button>
        <button className="icon-btn" aria-label="Flip" onClick={() => applyDoc((d) => ({ ...d, t: { ...d.t, flip: !d.t.flip } }))}>
          <I.Flip />
        </button>
        <button
          className="icon-btn"
          aria-label="Reset position"
          onClick={() => applyDoc((d) => ({ ...d, t: defaultTransform() }))}
        >
          <I.Reset />
        </button>
      </div>

      {fit && (
        <div className="swatches" aria-label="Background">
          <button
            className={doc.bg.kind === 'blur' ? 'swatch swatch-blur is-on' : 'swatch swatch-blur'}
            onClick={() => applyDoc((d) => ({ ...d, bg: { kind: 'blur' } }))}
          >
            Blur
          </button>
          {BG_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Background ${c}`}
              className={doc.bg.kind === 'color' && doc.bg.color === c ? 'swatch is-on' : 'swatch'}
              style={{ background: c }}
              onClick={() => applyDoc((d) => ({ ...d, bg: { kind: 'color', color: c } }))}
            />
          ))}
          <label className="swatch swatch-custom" aria-label="Custom background colour">
            <input
              type="color"
              value={doc.bg.kind === 'color' ? doc.bg.color : '#888888'}
              onFocus={checkpoint}
              onChange={(e) => setDoc((d) => ({ ...d, bg: { kind: 'color', color: e.target.value } }))}
              onBlur={commit}
            />
          </label>
        </div>
      )}

      {fit ? (
        <Slider
          label="Border"
          min={0}
          max={60}
          value={Math.round((1 - Math.min(1, doc.t.zoom)) * 100)}
          onStart={checkpoint}
          onEnd={commit}
          onChange={(v) => setDoc((d) => ({ ...d, t: { ...d.t, zoom: 1 - v / 100 } }))}
        />
      ) : (
        <Slider
          label="Straighten"
          min={-45}
          max={45}
          value={Math.round(doc.t.straighten)}
          format={(v) => `${v > 0 ? '+' : ''}${v}°`}
          onStart={checkpoint}
          onEnd={commit}
          onChange={(v) => setDoc((d) => ({ ...d, t: { ...d.t, straighten: v } }))}
        />
      )}
      <p className="hint">{fit ? 'Drag to move the photo.' : 'Drag to move · pinch to zoom.'}</p>
    </div>
  );
}

function FormatShape({ ratio }: { ratio: number | null }) {
  const r = ratio ?? 1.5;
  const w = r >= 1 ? 22 : 22 * r;
  const h = r >= 1 ? 22 / r : 22;
  return (
    <span className="format-shape" aria-hidden="true">
      <span style={{ width: w, height: h, borderStyle: ratio ? 'solid' : 'dashed' }} />
    </span>
  );
}

export function FilterTool() {
  const filter = useStore(editor, (s) => s.doc.filter);
  const strength = useStore(editor, (s) => s.doc.strength);
  const thumbs = useStore(editor, (s) => s.thumbs);
  return (
    <div className="tool">
      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={filter === f.id ? 'filter is-on' : 'filter'}
            aria-pressed={filter === f.id}
            onClick={() => applyDoc((d) => ({ ...d, filter: f.id, strength: d.filter === f.id ? d.strength : 1 }))}
          >
            <span className="filter-thumb">{thumbs[f.id] ? <img src={thumbs[f.id]} alt="" /> : null}</span>
            <span className="filter-name">{f.name}</span>
          </button>
        ))}
      </div>
      {filter !== 'none' ? (
        <Slider
          label="Strength"
          min={0}
          max={100}
          defaultValue={100}
          value={Math.round(strength * 100)}
          onStart={checkpoint}
          onEnd={commit}
          onChange={(v) => setDoc((d) => ({ ...d, strength: v / 100 }))}
        />
      ) : (
        <p className="hint">Pick a look. You can fine-tune it in Adjust.</p>
      )}
    </div>
  );
}

export function AdjustTool() {
  const adjust = useStore(editor, (s) => s.doc.adjust);
  const active = useStore(editor, (s) => s.activeAdjust);
  const info = adjustInfo(active);
  const anyChanged = ADJUSTMENTS.some((a) => adjust[a.key] !== 0);

  const auto = () => {
    const photo = get().photo;
    if (!photo) return;
    const values = autoEnhance(samplePixels(photo.proxy));
    applyDoc((d) => ({ ...d, adjust: { ...neutralAdjustments(), ...d.adjust, ...values } }));
  };

  return (
    <div className="tool">
      <div className="chips adjust-chips">
        <button className="chip chip-accent" onClick={auto}>
          <I.Sparkle size={18} /> Auto
        </button>
        {ADJUSTMENTS.map((a) => (
          <button
            key={a.key}
            className={active === a.key ? 'chip is-on' : 'chip'}
            onClick={() => patch({ activeAdjust: a.key })}
          >
            {a.label}
            {adjust[a.key] !== 0 && <span className="dot" />}
          </button>
        ))}
        {anyChanged && (
          <button className="chip" onClick={() => applyDoc((d) => ({ ...d, adjust: neutralAdjustments() }))}>
            Reset all
          </button>
        )}
      </div>
      <Slider
        label={info.label}
        min={info.min}
        max={info.max}
        value={adjust[active]}
        onStart={checkpoint}
        onEnd={commit}
        onChange={(v) => setDoc((d) => ({ ...d, adjust: { ...d.adjust, [active]: v } }))}
      />
    </div>
  );
}

let textCounter = 0;

export function addText(): void {
  const id = `t${Date.now().toString(36)}${textCounter++}`;
  checkpoint();
  setDoc((d) => ({ ...d, texts: [...d.texts, newTextLayer(id, '')] }));
  patch({ selected: id, editingText: id, tool: 'text' });
}

export function TextTool() {
  const selected = useStore(editor, (s) => s.selected);
  const layer = useStore(editor, (s) => s.doc.texts.find((l) => l.id === s.selected) ?? null);
  const count = useStore(editor, (s) => s.doc.texts.length);

  const duplicate = () => {
    if (!layer) return;
    const id = `t${Date.now().toString(36)}${textCounter++}`;
    applyDoc((d) => ({
      ...d,
      texts: [...d.texts, { ...layer, id, x: Math.min(0.9, layer.x + 0.04), y: Math.min(0.9, layer.y + 0.04) }],
    }));
    patch({ selected: id });
  };
  const remove = () => {
    applyDoc((d) => ({ ...d, texts: d.texts.filter((l) => l.id !== selected) }));
    patch({ selected: null });
  };

  return (
    <div className="tool">
      <div className="row">
        <button className="btn btn-primary grow" onClick={() => {
          // The text editor opens with its own history step.
          addText();
        }}>
          <I.Plus size={20} /> Add text
        </button>
        {layer && (
          <>
            <button className="icon-btn" aria-label="Edit text" onClick={() => {
              checkpoint();
              patch({ editingText: layer.id });
            }}>
              <I.Pencil />
            </button>
            <button className="icon-btn" aria-label="Duplicate text" onClick={duplicate}>
              <I.Duplicate />
            </button>
            <button className="icon-btn danger" aria-label="Delete text" onClick={remove}>
              <I.Trash />
            </button>
          </>
        )}
      </div>
      <p className="hint">
        {layer
          ? 'Drag to move · pinch to resize and rotate · tap again to edit.'
          : count
            ? 'Tap a text on the photo to select it.'
            : 'Add a caption, title or label.'}
      </p>
    </div>
  );
}

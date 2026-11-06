// Full-screen text entry. The controls sit at the top so the phone keyboard
// never covers them; the photo preview keeps updating behind the dimmed layer.
import { useEffect, useRef, type CSSProperties } from 'react';
import { useStore } from '../lib/store';
import { FONTS, TEXT_COLORS, TEXT_STYLES, contrastColor, fontCss, type TextAlign, type TextLayer } from '../lib/text';
import * as I from '../ui/Icons';
import { checkpoint, commit, editor, patch, setDoc } from './state';

const ALIGNS: TextAlign[] = ['left', 'center', 'right'];

export function TextEditor({ id }: { id: string }) {
  const layer = useStore(editor, (s) => s.doc.texts.find((l) => l.id === id) ?? null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    checkpoint();
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  if (!layer) return null;

  const update = (p: Partial<TextLayer>) =>
    setDoc((d) => ({ ...d, texts: d.texts.map((l) => (l.id === id ? { ...l, ...p } : l)) }));

  const done = () => {
    if (!layer.text.trim()) {
      setDoc((d) => ({ ...d, texts: d.texts.filter((l) => l.id !== id) }));
      patch({ selected: null });
    }
    commit();
    patch({ editingText: null });
  };

  const nextAlign = ALIGNS[(ALIGNS.indexOf(layer.align) + 1) % ALIGNS.length];
  const AlignIcon = layer.align === 'left' ? I.AlignLeft : layer.align === 'right' ? I.AlignRight : I.AlignCenter;
  const preview: CSSProperties = {
    font: fontCss(layer.font, 30),
    textAlign: layer.align,
    color: layer.style === 'box' ? contrastColor(layer.color) : layer.color,
    background: layer.style === 'box' ? layer.color : 'transparent',
    WebkitTextStroke: layer.style === 'outline' ? `1.5px ${contrastColor(layer.color)}` : undefined,
    textShadow: layer.style === 'shadow' ? '0 2px 8px rgba(0,0,0,.6)' : undefined,
  };

  return (
    <div className="text-editor" role="dialog" aria-label="Edit text">
      <div className="text-editor-bar">
        <button className="icon-btn" aria-label={`Align ${nextAlign}`} onClick={() => update({ align: nextAlign })}>
          <AlignIcon />
        </button>
        <div className="chips">
          {TEXT_STYLES.map((st) => (
            <button
              key={st.id}
              className={layer.style === st.id ? 'chip is-on' : 'chip'}
              onClick={() => update({ style: st.id })}
            >
              {st.label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={done}>
          Done
        </button>
      </div>
      <div className="chips text-fonts">
        {FONTS.map((f) => (
          <button
            key={f.id}
            className={layer.font === f.id ? 'chip is-on' : 'chip'}
            style={{ font: fontCss(f.id, 15) }}
            onClick={() => update({ font: f.id })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="text-colors">
        {TEXT_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Colour ${c}`}
            className={layer.color === c ? 'color-dot is-on' : 'color-dot'}
            style={{ background: c }}
            onClick={() => update({ color: c })}
          />
        ))}
      </div>
      <div className="text-editor-body" onClick={() => inputRef.current?.focus()}>
        <textarea
          ref={inputRef}
          className="text-input"
          value={layer.text}
          placeholder="Type something"
          rows={3}
          style={preview}
          onChange={(e) => update({ text: e.target.value.slice(0, 400) })}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) done();
          }}
        />
      </div>
    </div>
  );
}

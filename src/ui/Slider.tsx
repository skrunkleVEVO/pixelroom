// A thumb-friendly slider. Dragging anywhere on it moves the value relative to
// where the finger started (so the finger never covers the number and small
// changes are easy). Double-tap resets. It snaps to the default with a tick.
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  defaultValue?: number;
  format?: (value: number) => string;
}

export function Slider({ label, value, min, max, onChange, onStart, onEnd, defaultValue = 0, format }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  const span = max - min;
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  const pct = (v: number) => ((v - min) / span) * 100;
  const zero = Math.min(max, Math.max(min, defaultValue));

  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value, moved: false };
    onStart?.();
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    let next = clamp(d.start + (dx / el.clientWidth) * span);
    // A soft detent at the default value.
    if (Math.abs(next - zero) <= span * 0.015) next = zero;
    if (next === zero && value !== zero) navigator.vibrate?.(4);
    if (next !== value) onChange(next);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const now = performance.now();
      if (now - lastTap.current < 320) {
        onChange(zero);
        lastTap.current = 0;
      } else lastTap.current = now;
    }
    onEnd?.();
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = clamp(value + step);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = clamp(value - step);
    if (e.key === 'Home') next = min;
    if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    onStart?.();
    onChange(next);
    onEnd?.();
  };

  const lo = Math.min(pct(zero), pct(value));
  const hi = Math.max(pct(zero), pct(value));
  const text = format ? format(value) : value > 0 && min < 0 ? `+${value}` : String(value);

  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <span className={value === zero ? 'slider-value' : 'slider-value is-changed'}>{text}</span>
      </div>
      <div
        ref={ref}
        className="slider-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        <div className="slider-rail" />
        {zero > min && zero < max && <div className="slider-zero" style={{ left: `${pct(zero)}%` }} />}
        <div className="slider-fill" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        <div className="slider-thumb" style={{ left: `${pct(value)}%` }} />
      </div>
    </div>
  );
}

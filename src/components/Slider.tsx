import { memo, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { defaultParams, type EditParams, type Range } from '../engine/params';
import { actions, getState, useStore } from '../state/store';

interface SliderProps {
  label: string;
  value: number;
  range: Range;
  step?: number;
  resetValue: number;
  gradient?: string;
  format?: (value: number) => string;
  /** Narrow layout, stacked under a colour wheel. */
  compact?: boolean;
  onChange: (value: number) => void;
  onCommit: () => void;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

const DOUBLE_TAP_MS = 300;
const TOUCH_SLOP_PX = 3;

/**
 * A pointer-driven slider. With a mouse a press jumps to the position. With a
 * touch the drag is relative, so a thumb brushing the track while scrolling the
 * panel cannot change a value; `touch-action: pan-y` hands vertical moves to the
 * browser, which scrolls and cancels the pointer.
 */
export function Slider({
  label,
  value,
  range: [min, max],
  step = 1,
  resetValue,
  gradient,
  format = signed,
  compact = false,
  onChange,
  onCommit,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: number;
    touch: boolean;
    startX: number;
    startValue: number;
    active: boolean;
  } | null>(null);
  const lastTap = useRef(0);
  const [draft, setDraft] = useState<string | null>(null);

  const snap = (v: number) => {
    const snapped = Math.round(v / step) * step;
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(4));
  };

  const fromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return value;
    return min + ((clientX - rect.left) / rect.width) * (max - min);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    gesture.current = {
      id: e.pointerId,
      touch,
      startX: e.clientX,
      startValue: value,
      active: !touch,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!touch) onChange(snap(fromClientX(e.clientX)));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.touch) {
      onChange(snap(fromClientX(e.clientX)));
      return;
    }
    const dx = e.clientX - g.startX;
    if (!g.active && Math.abs(dx) < TOUCH_SLOP_PX) return;
    g.active = true;
    const width = trackRef.current?.getBoundingClientRect().width ?? 1;
    onChange(snap(g.startValue + (dx / width) * (max - min)));
  };

  const endGesture = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (g.touch && !g.active && !cancelled) {
      const now = performance.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        onChange(resetValue);
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
    onCommit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step * big;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step * big;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    onChange(snap(next));
    onCommit();
  };

  const reset = () => {
    onChange(resetValue);
    onCommit();
  };

  const commitDraft = () => {
    if (draft !== null) {
      const parsed = Number.parseFloat(draft);
      if (Number.isFinite(parsed)) {
        onChange(snap(parsed));
        onCommit();
      }
    }
    setDraft(null);
  };

  const position = (value - min) / (max - min);
  const anchor = min < 0 && max > 0 ? -min / (max - min) : 0;
  const fillLeft = Math.min(position, anchor);
  const fillWidth = Math.abs(position - anchor);

  return (
    <div className={`slider${compact ? ' compact' : ''}`}>
      <span className="slider-label" onDoubleClick={reset} title="Double-click to reset">
        {label}
      </span>
      <div
        className="slider-hit"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e, false)}
        onPointerCancel={(e) => endGesture(e, true)}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
      >
        <div className="slider-track" ref={trackRef} style={gradient ? { background: gradient } : undefined}>
          {!gradient && (
            <div
              className="slider-fill"
              style={{ left: `${fillLeft * 100}%`, width: `${fillWidth * 100}%` }}
            />
          )}
          {anchor > 0 && <div className="slider-tick" style={{ left: `${anchor * 100}%` }} />}
          <div className="slider-thumb" style={{ left: `${position * 100}%` }} />
        </div>
      </div>
      <input
          className={`slider-value${value !== resetValue ? ' changed' : ''}`}
          inputMode="decimal"
          aria-label={`${label} value`}
          value={draft ?? format(value)}
          onFocus={(e) => {
            setDraft(format(value));
            e.currentTarget.select();
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(null);
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
      />
    </div>
  );
}

interface ParamSliderProps {
  label: string;
  get: (p: EditParams) => number;
  set: (p: EditParams, value: number) => void;
  range: Range;
  step?: number;
  gradient?: string;
  format?: (value: number) => string;
  compact?: boolean;
  /** Name in the History panel, when the label alone is ambiguous. */
  historyLabel?: string;
}

const NEUTRAL = defaultParams();

/** A slider bound to one parameter; it subscribes to that value alone. */
export const ParamSlider = memo(function ParamSlider({ get, set, historyLabel, ...rest }: ParamSliderProps) {
  const value = useStore((s) => get(s.params));
  return (
    <Slider
      {...rest}
      value={value}
      resetValue={get(NEUTRAL)}
      onChange={(v) => actions.update((draft) => set(draft, v))}
      onCommit={() => {
        const shown = (rest.format ?? signed)(get(getState().params));
        actions.commit(`${historyLabel ?? rest.label} ${shown}`);
      }}
    />
  );
});

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

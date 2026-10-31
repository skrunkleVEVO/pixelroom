import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { createSpline } from '../engine/curves';
import { identityCurve, type CurveChannel, type CurvePoint } from '../engine/params';
import { actions, useStore } from '../state/store';

const TABS: { id: CurveChannel; label: string; color: string }[] = [
  { id: 'rgb', label: 'RGB', color: '#e8e8e8' },
  { id: 'red', label: 'Red', color: '#ff5a5a' },
  { id: 'green', label: 'Green', color: '#4fd16a' },
  { id: 'blue', label: 'Blue', color: '#5a9bff' },
];

const SIZE = 255;

function curvePath(points: CurvePoint[]): string {
  const spline = createSpline(points);
  let d = '';
  for (let x = 0; x <= SIZE; x += 2) {
    const y = Math.max(0, Math.min(SIZE, spline(x)));
    d += `${d ? 'L' : 'M'}${x} ${SIZE - y}`;
  }
  return d;
}

export function CurveEditor() {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const points = useStore((s) => s.params.curve[channel]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; id: number } | null>(null);
  const lastTap = useRef({ time: 0, index: -1 });
  const [readout, setReadout] = useState<CurvePoint | null>(null);

  const tab = TABS.find((t) => t.id === channel) ?? TABS[0];
  const path = useMemo(() => curvePath(points), [points]);

  const toCurve = (e: PointerEvent<SVGSVGElement>): CurvePoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [
      ((e.clientX - rect.left) / rect.width) * SIZE,
      (1 - (e.clientY - rect.top) / rect.height) * SIZE,
    ];
  };

  const removePoint = (index: number) => {
    if (points.length <= 2) return;
    actions.change((p) => {
      p.curve[channel].splice(index, 1);
    });
    setReadout(null);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const [x, y] = toCurve(e);
    const reach = e.pointerType === 'touch' ? 26 : 12;
    let index = -1;
    let best = reach;
    points.forEach((p, i) => {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < best) {
        best = d;
        index = i;
      }
    });

    if (index >= 0) {
      const now = performance.now();
      if (lastTap.current.index === index && now - lastTap.current.time < 320) {
        lastTap.current = { time: 0, index: -1 };
        if (index > 0 && index < points.length - 1) removePoint(index);
        return;
      }
      lastTap.current = { time: now, index };
    } else {
      // Adding a point: keep it clear of its neighbours on the x axis.
      const ix = Math.round(x);
      if (points.some((p) => Math.abs(p[0] - ix) < 3)) return;
      index = points.findIndex((p) => p[0] > ix);
      if (index < 0) index = points.length;
      const point: CurvePoint = [ix, Math.round(y)];
      const at = index;
      actions.update((p) => {
        p.curve[channel].splice(at, 0, point);
      });
      setReadout(point);
    }
    drag.current = { index, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const [x, y] = toCurve(e);
    actions.update((p) => {
      const list = p.curve[channel];
      const lo = d.index > 0 ? list[d.index - 1][0] + 1 : 0;
      const hi = d.index < list.length - 1 ? list[d.index + 1][0] - 1 : SIZE;
      const next: CurvePoint = [
        Math.round(Math.max(lo, Math.min(hi, x))),
        Math.round(Math.max(0, Math.min(SIZE, y))),
      ];
      list[d.index] = next;
      setReadout(next);
    });
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    actions.commit();
  };

  const isChanged = (ch: CurveChannel, list: CurvePoint[]) =>
    ch && !(list.length === 2 && list[0][0] === 0 && list[0][1] === 0 && list[1][0] === 255 && list[1][1] === 255);

  return (
    <div className="curve">
      <div className="segmented" role="tablist" aria-label="Curve channel">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === channel}
            className={t.id === channel ? 'active' : ''}
            onClick={() => {
              setChannel(t.id);
              setReadout(null);
            }}
          >
            <span className="dot" style={{ background: t.color }} />
            {t.label}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        className="curve-graph"
        viewBox={`-2 -2 ${SIZE + 4} ${SIZE + 4}`}
        role="img"
        aria-label={`${tab.label} tone curve with ${points.length} control points`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect x="0" y="0" width={SIZE} height={SIZE} className="curve-bg" />
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} className="curve-grid">
            <line x1={f * SIZE} y1="0" x2={f * SIZE} y2={SIZE} />
            <line x1="0" y1={f * SIZE} x2={SIZE} y2={f * SIZE} />
          </g>
        ))}
        <line x1="0" y1={SIZE} x2={SIZE} y2="0" className="curve-diagonal" />
        <path d={path} fill="none" stroke={tab.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={SIZE - p[1]}
            r="5"
            fill="#141414"
            stroke={tab.color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="curve-foot">
        <span className="hint">
          {readout ? `In ${readout[0]} / Out ${readout[1]}` : 'Tap to add. Drag to move. Double-tap to remove.'}
        </span>
        <button
          className="text-button"
          disabled={!isChanged(channel, points)}
          onClick={() =>
            actions.change((p) => {
              p.curve[channel] = identityCurve();
            })
          }
        >
          Reset
        </button>
      </div>
    </div>
  );
}

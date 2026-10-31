import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { attachRenderer, openFile, openSample } from '../state/editor';
import { actions, useStore } from '../state/store';
import { OpenIcon } from './Icons';

const LONG_PRESS_MS = 350;
const MOVE_SLOP_PX = 8;
const MAX_ZOOM = 8;

interface ViewerProps {
  onOpenClick: () => void;
}

/**
 * Shows the photo. Zoom and pan are CSS variables written straight to the DOM,
 * so they never trigger a React render or a shader run. Both canvases read the
 * same variables, which keeps Before and After locked together.
 */
export function Viewer({ onOpenClick }: ViewerProps) {
  const photo = useStore((s) => s.photo);
  const compare = useStore((s) => s.compare);
  const peek = useStore((s) => s.peek);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const view = useRef({ zoom: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef(0);
  const pressTimer = useRef<number | undefined>(undefined);
  const pressStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!canvasRef.current || !beforeRef.current) return;
    try {
      attachRenderer(canvasRef.current, beforeRef.current);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : 'Could not start the renderer.');
    }
  }, []);

  const applyView = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const v = view.current;
    const panes = stage.querySelector('.pane.after') as HTMLElement | null;
    const w = panes?.clientWidth ?? stage.clientWidth;
    const h = panes?.clientHeight ?? stage.clientHeight;
    const limitX = ((v.zoom - 1) * w) / 2;
    const limitY = ((v.zoom - 1) * h) / 2;
    v.x = Math.max(-limitX, Math.min(limitX, v.x));
    v.y = Math.max(-limitY, Math.min(limitY, v.y));
    stage.style.setProperty('--zoom', `${v.zoom}`);
    stage.style.setProperty('--tx', `${v.x}px`);
    stage.style.setProperty('--ty', `${v.y}px`);
  };

  const zoomAt = (clientX: number, clientY: number, nextZoom: number) => {
    const pane = stageRef.current?.querySelector('.pane.after');
    if (!pane) return;
    const rect = pane.getBoundingClientRect();
    const v = view.current;
    const zoom = Math.max(1, Math.min(MAX_ZOOM, nextZoom));
    const px = clientX - rect.left - rect.width / 2;
    const py = clientY - rect.top - rect.height / 2;
    v.x = px - (px - v.x) * (zoom / v.zoom);
    v.y = py - (py - v.y) * (zoom / v.zoom);
    v.zoom = zoom;
    applyView();
  };

  useEffect(() => {
    view.current = { zoom: 1, x: 0, y: 0 };
    applyView();
  }, [photo]);

  // Wheel must be non-passive to stop the page from zooming on trackpad pinch.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, view.current.zoom * Math.exp(-e.deltaY * 0.0022));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  const clearPress = () => {
    window.clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!photo) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      pressStart.current = { x: e.clientX, y: e.clientY };
      clearPress();
      pressTimer.current = window.setTimeout(() => actions.setPeek(true), LONG_PRESS_MS);
    } else {
      clearPress();
      actions.setPeek(false);
      const [a, b] = [...pointers.current.values()];
      pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(e.pointerId);
    if (!previous) return;
    const point = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, point);

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance.current > 0) {
        zoomAt(
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
          view.current.zoom * (distance / pinchDistance.current),
        );
      }
      pinchDistance.current = distance;
      return;
    }

    if (Math.hypot(point.x - pressStart.current.x, point.y - pressStart.current.y) > MOVE_SLOP_PX) {
      clearPress();
    }
    if (view.current.zoom > 1) {
      view.current.x += point.x - previous.x;
      view.current.y += point.y - previous.y;
      applyView();
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    pinchDistance.current = 0;
    clearPress();
    actions.setPeek(false);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!photo) return;
    zoomAt(e.clientX, e.clientY, view.current.zoom > 1 ? 1 : 2.5);
  };

  const stageClass = ['stage', compare === 'side' ? 'side' : '', peek ? 'peek' : '', photo ? '' : 'empty', dragOver ? 'dragover' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={stageRef}
      className={stageClass}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      <figure className="pane before">
        <canvas ref={beforeRef} className="photo" aria-label="Original photo" />
        <figcaption>Before</figcaption>
      </figure>
      <figure className="pane after">
        <canvas ref={canvasRef} className="photo" aria-label="Edited photo" />
        <figcaption>After</figcaption>
      </figure>

      {!photo && (
        <div className="empty-state" onPointerDown={(e) => e.stopPropagation()}>
          {fatal ? (
            <>
              <h1>This browser cannot run PixelRoom</h1>
              <p>{fatal}</p>
            </>
          ) : (
            <>
              <h1>Open a photo to start editing</h1>
              <p>Drop a JPEG, PNG, WebP or AVIF here. Photos stay on this device.</p>
              <div className="empty-actions">
                <button className="button primary" onClick={onOpenClick}>
                  <OpenIcon /> Open photo
                </button>
                <button className="button" onClick={openSample}>
                  Use sample scene
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

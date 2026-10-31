import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { outputSize } from '../engine/geometry';
import { MAX_ZOOM, MIN_ZOOM, imageRect, panes } from '../engine/view';
import { attachRenderer, importFiles, openSample, pickWhiteBalance, readColorAt, setRendererLayout } from '../state/editor';
import { actions, getState, useStore } from '../state/store';
import { CropOverlay } from './CropOverlay';
import { OpenIcon } from './Icons';
import { InstallHint } from './MobileTools';
import { useMediaQuery } from './Slider';

const LONG_PRESS_MS = 350;
const MOVE_SLOP_PX = 4;
const DOUBLE_TAP_MS = 300;
const FIT_MARGIN_CSS = 14;

interface ViewerProps {
  onOpenClick: () => void;
}

/** Current image placement in device pixels, for mapping pointers to the photo. */
function placement() {
  const s = getState();
  const photo = s.catalog.find((p) => p.id === s.activeId);
  if (!photo) return null;
  const { dpr, width, height } = s.stage;
  const g = s.tool === 'crop' ? { ...s.params.geometry, x: 0, y: 0, w: 1, h: 1 } : s.params.geometry;
  const out = outputSize(g, photo.width, photo.height);
  const pane = panes(Math.round(width * dpr), Math.round(height * dpr), s.compare === 'side').slice(-1)[0];
  const margin = Math.round(FIT_MARGIN_CSS * dpr);
  return { out, pane, dpr, margin, rect: imageRect(s.view, out.width, out.height, pane, margin) };
}

/**
 * Shows the photo. The canvas is exactly the stage in device pixels and the renderer
 * draws the zoomed, panned picture into it, so nothing is rescaled by the browser and
 * 1:1 means one source pixel on one screen pixel. Mouse: click toggles Fit and 1:1
 * at that spot, drag pans, hold peeks at the original. Touch: double-tap, pinch.
 */
export function Viewer({ onOpenClick }: ViewerProps) {
  const hasPhoto = useStore((s) => s.activeId !== null);
  const peek = useStore((s) => s.peek);
  const compare = useStore((s) => s.compare);
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.view.zoom);
  const touch = useMediaQuery('(pointer: coarse)');
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef(0);
  const pressTimer = useRef<number | undefined>(undefined);
  const gesture = useRef({ startX: 0, startY: 0, moved: false, peeked: false });
  const lastTap = useRef(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      attachRenderer(canvasRef.current);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : 'Could not start the renderer.');
    }
  }, []);

  // The canvas buffer follows the stage size and the screen's pixel density.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      actions.setStage({ width: rect.width, height: rect.height, dpr });
      setRendererLayout(rect.width, rect.height, dpr);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  /** Zooms keeping the image point under the pointer where it is. */
  const zoomAt = (clientX: number, clientY: number, next: number | 'fit') => {
    const stage = stageRef.current;
    const p = placement();
    if (!stage || !p) return;
    if (next === 'fit') {
      actions.setView({ zoom: 'fit', cx: 0.5, cy: 0.5 });
      return;
    }
    const zoomValue = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    const bounds = stage.getBoundingClientRect();
    const px = (clientX - bounds.left) * p.dpr;
    const py = (clientY - bounds.top) * p.dpr;
    const u = Math.max(0, Math.min(1, (px - p.rect.x) / p.rect.w));
    const v = Math.max(0, Math.min(1, (py - p.rect.y) / p.rect.h));
    const paneX = px - p.pane.x;
    const paneY = py - p.pane.y;
    actions.setView({
      zoom: zoomValue,
      cx: u + (p.pane.w / 2 - paneX) / (p.out.width * zoomValue),
      cy: v + (p.pane.h / 2 - paneY) / (p.out.height * zoomValue),
    });
  };

  // Wheel must be non-passive to stop the page from zooming on trackpad pinch.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = placement();
      if (!p || getState().tool === 'crop') return;
      zoomAt(e.clientX, e.clientY, p.rect.scale * Math.exp(-e.deltaY * 0.0022));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  const clearPress = () => {
    window.clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasPhoto || tool === 'crop') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { startX: e.clientX, startY: e.clientY, moved: false, peeked: false };
      clearPress();
      if (tool === 'none') {
        pressTimer.current = window.setTimeout(() => {
          gesture.current.peeked = true;
          actions.setPeek(true);
        }, LONG_PRESS_MS);
      }
    } else {
      clearPress();
      actions.setPeek(false);
      gesture.current.moved = true;
      const [a, b] = [...pointers.current.values()];
      pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (bounds && pointers.current.size === 0 && hasPhoto && e.pointerType === 'mouse') {
      readColorAt(e.clientX - bounds.left, e.clientY - bounds.top);
    }
    const previous = pointers.current.get(e.pointerId);
    if (!previous) return;
    const point = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, point);

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const p = placement();
      if (pinchDistance.current > 0 && p) {
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, p.rect.scale * (distance / pinchDistance.current));
      }
      pinchDistance.current = distance;
      return;
    }

    if (Math.hypot(point.x - gesture.current.startX, point.y - gesture.current.startY) > MOVE_SLOP_PX) {
      gesture.current.moved = true;
      clearPress();
    }
    const p = placement();
    if (!p || !gesture.current.moved) return;
    const overflow = p.rect.w > p.pane.w || p.rect.h > p.pane.h;
    if (overflow) {
      const { view } = getState();
      // Resolve Fill to a number on first pan, so the view stays where it was dragged.
      actions.setView({
        zoom: view.zoom === 'fill' ? p.rect.scale : view.zoom,
        cx: Math.max(0, Math.min(1, view.cx - ((point.x - previous.x) * p.dpr) / p.rect.w)),
        cy: Math.max(0, Math.min(1, view.cy - ((point.y - previous.y) * p.dpr) / p.rect.h)),
      });
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const had = pointers.current.delete(e.pointerId);
    pinchDistance.current = 0;
    clearPress();
    actions.setPeek(false);
    if (!had || pointers.current.size > 0 || e.type === 'pointercancel') return;
    const { moved, peeked } = gesture.current;
    if (moved || peeked) return;

    const bounds = stageRef.current?.getBoundingClientRect();
    if (tool === 'whiteBalance' && bounds) {
      if (pickWhiteBalance(e.clientX - bounds.left, e.clientY - bounds.top)) actions.setTool('none');
      return;
    }
    const toggle = () => {
      const fit = getState().view.zoom === 'fit';
      zoomAt(e.clientX, e.clientY, fit ? 1 : 'fit');
    };
    if (e.pointerType === 'mouse') {
      toggle();
    } else {
      const now = performance.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        toggle();
      } else {
        lastTap.current = now;
      }
    }
  };

  const stageClass = [
    'stage',
    !hasPhoto ? 'empty' : '',
    dragOver ? 'dragover' : '',
    tool === 'whiteBalance' ? 'picking' : zoom === 'fit' ? 'can-zoom' : 'can-pan',
  ]
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
      onPointerLeave={() => actions.setReadout(null)}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) void importFiles(files);
      }}
    >
      <canvas ref={canvasRef} className="photo" aria-label="Photo" />
      {compare === 'side' && hasPhoto && (
        <div className="compare-labels" aria-hidden="true">
          <span>Before</span>
          <span>After</span>
        </div>
      )}
      {peek && compare !== 'side' && <div className="peek-label">Before</div>}
      {tool === 'crop' && hasPhoto && <CropOverlay />}

      {!hasPhoto && (
        <div className="empty-state" onPointerDown={(e) => e.stopPropagation()}>
          {fatal ? (
            <>
              <h1>This browser cannot run PixelRoom</h1>
              <p>{fatal}</p>
            </>
          ) : (
            <>
              <h1>Import photos to start editing</h1>
              <p>{touch ? 'Pick photos from your library.' : 'Drop JPEG, PNG, WebP or AVIF files here.'} Photos stay on this device.</p>
              <div className="empty-actions">
                <button className="button primary" onClick={onOpenClick}>
                  <OpenIcon /> Import photos
                </button>
                <button className="button" onClick={openSample}>
                  Use sample scene
                </button>
              </div>
              {touch && <InstallHint />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

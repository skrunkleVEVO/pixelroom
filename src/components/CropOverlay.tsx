import { useRef, type PointerEvent } from 'react';
import { cropFit, orientedSize, type Geometry } from '../engine/geometry';
import { imageRect, panes } from '../engine/view';
import { actions, activePhoto, useStore } from '../state/store';

const FIT_MARGIN_CSS = 14;
const MIN_SIZE = 0.02;

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The crop rectangle over the straightened frame. Commits one history step per drag. */
export function CropOverlay() {
  const geometry = useStore((s) => s.params.geometry);
  const stage = useStore((s) => s.stage);
  const view = useStore((s) => s.view);
  const aspect = useStore((s) => s.cropAspect);
  const photo = useStore(activePhoto);
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Geometry } | null>(null);

  if (!photo) return null;
  const [fw, fh] = orientedSize(geometry, photo.width, photo.height);
  const { dpr } = stage;
  const pane = panes(Math.round(stage.width * dpr), Math.round(stage.height * dpr), false)[0];
  const rect = imageRect(view, fw, fh, pane, Math.round(FIT_MARGIN_CSS * dpr));
  const left = rect.x / dpr;
  const top = rect.y / dpr;
  const width = rect.w / dpr;
  const height = rect.h / dpr;

  const resize = (d: NonNullable<typeof drag.current>, dx: number, dy: number): Geometry => {
    const { start, handle } = d;
    let x0 = start.x;
    let y0 = start.y;
    let x1 = start.x + start.w;
    let y1 = start.y + start.h;
    if (handle === 'move') {
      const nx = Math.max(0, Math.min(1 - start.w, start.x + dx));
      const ny = Math.max(0, Math.min(1 - start.h, start.y + dy));
      return { ...start, x: nx, y: ny };
    }
    if (handle.includes('w')) x0 = Math.min(x1 - MIN_SIZE, Math.max(0, x0 + dx));
    if (handle.includes('e')) x1 = Math.max(x0 + MIN_SIZE, Math.min(1, x1 + dx));
    if (handle.includes('n')) y0 = Math.min(y1 - MIN_SIZE, Math.max(0, y0 + dy));
    if (handle.includes('s')) y1 = Math.max(y0 + MIN_SIZE, Math.min(1, y1 + dy));
    let next: Geometry = { ...start, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (aspect) {
      // Keep the ratio in pixels, growing from the corner opposite the handle.
      const pixelW = next.w * fw;
      const pixelH = next.h * fh;
      const horizontalOnly = handle === 'e' || handle === 'w';
      const verticalOnly = handle === 'n' || handle === 's';
      const h = verticalOnly || (!horizontalOnly && pixelW / aspect < pixelH) ? pixelH : pixelW / aspect;
      const w = h * aspect;
      const nw = w / fw;
      const nh = h / fh;
      const nx = handle.includes('w') ? x1 - nw : horizontalOnly || !verticalOnly ? x0 : (x0 + x1) / 2 - nw / 2;
      const ny = handle.includes('n') ? y1 - nh : verticalOnly || !horizontalOnly ? y0 : (y0 + y1) / 2 - nh / 2;
      next = { ...start, x: nx, y: ny, w: nw, h: nh };
      if (nx < 0 || ny < 0 || nx + nw > 1 || ny + nh > 1) return start;
    }
    return next;
  };

  const onPointerDown = (handle: Handle) => (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: geometry };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const next = resize(d, (e.clientX - d.x) / width, (e.clientY - d.y) / height);
    // A straightened photo has empty corners; never let the crop reach them.
    if (cropFit(next, photo.width, photo.height) < 0.9999) return;
    actions.update((p) => {
      p.geometry = next;
    });
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    e.stopPropagation();
    drag.current = null;
    actions.commit('Crop');
  };

  const box = {
    left: left + geometry.x * width,
    top: top + geometry.y * height,
    width: geometry.w * width,
    height: geometry.h * height,
  };

  return (
    <div className="crop-layer">
      <div
        className="crop-box"
        style={box}
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <i className="third v1" />
        <i className="third v2" />
        <i className="third h1" />
        <i className="third h2" />
        {HANDLES.map((handle) => (
          <b
            key={handle}
            className={`crop-handle ${handle}`}
            onPointerDown={onPointerDown(handle)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        ))}
      </div>
    </div>
  );
}

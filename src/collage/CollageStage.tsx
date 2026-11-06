// Live collage preview. Tap a cell to select it; drag and pinch to position its
// photo. In swap mode the next tapped cell trades photos with the selected one.
import { useEffect, useRef } from 'react';
import { drawCollage, hitCell, radiusPx, roundedPath, type PxRect } from '../lib/collage';
import { context2d } from '../lib/image';
import type { Transform } from '../lib/layout';
import { checkpoint, collage, commit, patchCollage, previewImages, ratioOf, setDoc, swapCells } from './state';

export function CollageStage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = context2d(canvas);
    let raf = 0;
    let cells: PxRect[] = [];
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    function draw() {
      raf = 0;
      const s = collage.get();
      if (!s.doc.cells.length) return;
      const ratio = ratioOf(s.doc);
      const pad = 14;
      const aw = Math.max(40, wrap.clientWidth - pad * 2);
      const ah = Math.max(40, wrap.clientHeight - pad * 2);
      let w = aw;
      let h = w / ratio;
      if (h > ah) {
        h = ah;
        w = h * ratio;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      cells = drawCollage(ctx, bw, bh, s.doc, previewImages(s));

      // Selection outline (preview only).
      if (s.selected !== null && cells[s.selected]) {
        const r = cells[s.selected];
        ctx.save();
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = s.swapping ? '#ffd60a' : '#ff3d6e';
        if (s.swapping) ctx.setLineDash([8 * dpr, 6 * dpr]);
        const inset = 1.5 * dpr;
        roundedPath(ctx, { x: r.x + inset, y: r.y + inset, w: r.w - inset * 2, h: r.h - inset * 2 }, radiusPx(s.doc.radius, bw, bh));
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---------------------------------------------------------------- gestures
    const pointers = new Map<number, { x: number; y: number }>();
    let g: { cell: number; startT: Transform; cx: number; cy: number; dist: number; moved: boolean } | null = null;

    const centroid = () => {
      const pts = [...pointers.values()];
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const dist = pts.length >= 2 ? Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)) : 1;
      return { cx, cy, dist };
    };

    const baseline = (cell: number, keepMoved: boolean) => {
      const t = collage.get().doc.cells[cell]?.t;
      if (!t) return;
      g = { cell, startT: t, ...centroid(), moved: keepMoved && !!g?.moved };
    };

    const toCanvas = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const k = canvas.width / rect.width;
      return [(e.clientX - rect.left) * k, (e.clientY - rect.top) * k] as const;
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const [px, py] = toCanvas(e);
        const idx = hitCell(cells, px, py);
        const s = collage.get();
        if (idx < 0) {
          patchCollage({ selected: null, swapping: false });
          g = null;
          return;
        }
        if (s.swapping && s.selected !== null) {
          swapCells(s.selected, idx);
          patchCollage({ selected: idx, swapping: false });
          g = null;
          return;
        }
        if (s.selected !== idx) patchCollage({ selected: idx });
        checkpoint();
        g = null;
        baseline(idx, false);
      } else if (g) {
        baseline(g.cell, true);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !g) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = centroid();
      const dx = c.cx - g.cx;
      const dy = c.cy - g.cy;
      if (!g.moved && Math.hypot(dx, dy) < 5 && Math.abs(c.dist - g.dist) < 5) return;
      g.moved = true;
      const rect = canvas.getBoundingClientRect();
      const k = canvas.width / rect.width;
      const cell = cells[g.cell];
      if (!cell) return;
      const ratio = pointers.size >= 2 ? c.dist / g.dist : 1;
      const t0 = g.startT;
      const i = g.cell;
      const t: Transform = { ...t0, x: t0.x + (dx * k) / cell.w, y: t0.y + (dy * k) / cell.h, zoom: t0.zoom * ratio };
      setDoc((d) => ({ ...d, cells: d.cells.map((cl, j) => (j === i ? { ...cl, t } : cl)) }));
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size > 0 && g) {
        baseline(g.cell, true);
        return;
      }
      g = null;
      commit();
    };

    let wheelTimer = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = toCanvas(e as unknown as PointerEvent);
      const idx = hitCell(cells, px, py);
      if (idx < 0) return;
      checkpoint();
      const k = Math.exp(-e.deltaY * 0.0015);
      setDoc((d) => ({ ...d, cells: d.cells.map((cl, j) => (j === idx ? { ...cl, t: { ...cl.t, zoom: cl.t.zoom * k } } : cl)) }));
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(commit, 300);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const unsubscribe = collage.subscribe(schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(wrap);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div className="stage" ref={wrapRef}>
      <canvas ref={canvasRef} className="stage-canvas" />
    </div>
  );
}

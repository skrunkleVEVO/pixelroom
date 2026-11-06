// The live preview, and every touch gesture on it: drag and pinch the photo, or a
// text layer (pinch also rotates text). Draws straight to the canvas, outside React.
import { useEffect, useRef } from 'react';
import { neutralAdjustments, resolveLook, FILTERS } from '../lib/adjust';
import { compose } from '../lib/compose';
import { context2d, createCanvas } from '../lib/image';
import { frameRatio, type Transform } from '../lib/layout';
import { processor } from '../lib/processor';
import { hitText, textBox, type TextLayer } from '../lib/text';
import { checkpoint, commit, editor, get, lookOf, patch, setDoc } from './state';

const ORIGINAL_LOOK = resolveLook(FILTERS[0], 0, neutralAdjustments());

interface Gesture {
  target: 'photo' | string;
  startT: Transform;
  startText: TextLayer | null;
  cx: number;
  cy: number;
  dist: number;
  angle: number;
  moved: boolean;
  time: number;
  wasSelected: boolean;
}

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = context2d(canvas);
    const processed = createCanvas(1, 1);
    const processedCtx = context2d(processed);
    let version = 0;
    let lookKey = '';
    let lastProxy: HTMLCanvasElement | null = null;
    let raf = 0;
    const guides = { v: false, h: false };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    function layout(): boolean {
      const s = get();
      if (!s.photo) return false;
      const ratio = frameRatio(s.doc.format, s.photo.width, s.photo.height, s.doc.t.turns);
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
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      return true;
    }

    function draw() {
      raf = 0;
      if (!layout()) return;
      const s = get();
      const photo = s.photo!;
      const look = s.comparing ? ORIGINAL_LOOK : lookOf(s.doc);
      const { vignette: _v, grain: _g, ...pixelLook } = look;
      const key = JSON.stringify(pixelLook);
      if (key !== lookKey || photo.proxy !== lastProxy) {
        const out = processor().process(photo.proxy, photo.proxy.width, photo.proxy.height, look);
        if (processed.width !== out.width || processed.height !== out.height) {
          processed.width = out.width;
          processed.height = out.height;
        }
        processedCtx.clearRect(0, 0, out.width, out.height);
        processedCtx.drawImage(out, 0, 0);
        lookKey = key;
        lastProxy = photo.proxy;
        version++;
      }
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      compose(ctx, W, H, {
        photo: processed,
        version,
        sourceW: photo.width,
        sourceH: photo.height,
        mode: s.doc.mode,
        t: s.doc.t,
        bg: s.doc.bg,
        look,
        texts: s.doc.texts.filter((l) => l.id !== s.editingText),
      });

      // Selection and snapping guides (preview only).
      const dpr = W / canvas.clientWidth || 1;
      const sel = s.doc.texts.find((l) => l.id === s.selected);
      ctx.save();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 3 * dpr;
      if (sel && !s.editingText && sel.text.trim()) {
        const box = textBox(sel, W);
        ctx.save();
        ctx.translate(sel.x * W, sel.y * H);
        ctx.rotate(sel.rotation);
        ctx.setLineDash([6 * dpr, 5 * dpr]);
        const r = 6 * dpr;
        ctx.strokeRect(-box.width / 2 - r, -box.height / 2 - r, box.width + r * 2, box.height + r * 2);
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(255,214,10,0.95)';
      if (guides.v) {
        ctx.beginPath();
        ctx.moveTo(W / 2, 0);
        ctx.lineTo(W / 2, H);
        ctx.stroke();
      }
      if (guides.h) {
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---------------------------------------------------------------- gestures
    const pointers = new Map<number, { x: number; y: number }>();
    let g: Gesture | null = null;

    function centroid() {
      const pts = [...pointers.values()];
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      let dist = 1;
      let angle = 0;
      if (pts.length >= 2) {
        dist = Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
        angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      }
      return { cx, cy, dist, angle };
    }

    /** (Re)starts the gesture from the current state, e.g. when a finger is added. */
    function baseline(target: 'photo' | string, wasSelected: boolean, keepMoved: boolean) {
      const s = get();
      const c = centroid();
      g = {
        target,
        startT: s.doc.t,
        startText: s.doc.texts.find((l) => l.id === target) ?? null,
        ...c,
        moved: keepMoved && !!g?.moved,
        time: g && keepMoved ? g.time : performance.now(),
        wasSelected,
      };
    }

    function hitTest(clientX: number, clientY: number): string | null {
      const s = get();
      const rect = canvas.getBoundingClientRect();
      const W = canvas.width;
      const H = canvas.height;
      const k = W / rect.width;
      const px = (clientX - rect.left) * k;
      const py = (clientY - rect.top) * k;
      for (let i = s.doc.texts.length - 1; i >= 0; i--) {
        const l = s.doc.texts[i];
        if (l.text.trim() && hitText(l, W, H, px, py, 14 * k)) return l.id;
      }
      return null;
    }

    const onDown = (e: PointerEvent) => {
      if (!get().photo) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const hit = hitTest(e.clientX, e.clientY);
        const s = get();
        const wasSelected = !!hit && s.selected === hit;
        if (hit) {
          if (s.tool !== 'text' || s.selected !== hit) patch({ selected: hit, tool: 'text' });
        } else if (s.selected) patch({ selected: null });
        checkpoint();
        g = null;
        baseline(hit ?? 'photo', wasSelected, false);
      } else if (g) {
        baseline(g.target, g.wasSelected, true);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !g) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = centroid();
      const rect = canvas.getBoundingClientRect();
      const dx = c.cx - g.cx;
      const dy = c.cy - g.cy;
      if (!g.moved && Math.hypot(dx, dy) < 6 && Math.abs(c.dist - g.dist) < 6) return;
      g.moved = true;
      const ratio = pointers.size >= 2 ? c.dist / g.dist : 1;
      if (g.target === 'photo') {
        const t0 = g.startT;
        setDoc((d) => ({
          ...d,
          t: { ...d.t, x: t0.x + dx / rect.width, y: t0.y + dy / rect.height, zoom: t0.zoom * ratio },
        }));
      } else if (g.startText) {
        const l0 = g.startText;
        let x = l0.x + dx / rect.width;
        let y = l0.y + dy / rect.height;
        guides.v = Math.abs(x - 0.5) < 0.015;
        guides.h = Math.abs(y - 0.5) < 0.012;
        if (guides.v) x = 0.5;
        if (guides.h) y = 0.5;
        let rotation = l0.rotation;
        if (pointers.size >= 2) {
          rotation = l0.rotation + (c.angle - g.angle);
          const deg = ((((rotation * 180) / Math.PI) % 360) + 360) % 360;
          const nearest = Math.round(deg / 90) * 90;
          if (Math.abs(deg - nearest) < 4) rotation = (nearest * Math.PI) / 180;
        }
        const size = Math.min(0.6, Math.max(0.02, l0.size * ratio));
        const id = g.target;
        setDoc((d) => ({ ...d, texts: d.texts.map((l) => (l.id === id ? { ...l, x, y, size, rotation } : l)) }));
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size > 0 && g) {
        baseline(g.target, g.wasSelected, true);
        return;
      }
      const done = g;
      g = null;
      guides.v = guides.h = false;
      commit();
      if (done && !done.moved && performance.now() - done.time < 400 && done.target !== 'photo' && done.wasSelected) {
        patch({ editingText: done.target });
      }
      schedule();
    };

    let wheelTimer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!get().photo) return;
      e.preventDefault();
      checkpoint();
      const k = Math.exp(-e.deltaY * 0.0015);
      setDoc((d) => ({ ...d, t: { ...d.t, zoom: d.t.zoom * k } }));
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(commit, 300);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const unsubscribe = editor.subscribe(schedule);
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

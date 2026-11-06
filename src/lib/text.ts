// Text layers: data, drawing and hit-testing. Sizes are fractions of the frame
// width so text looks the same in the preview and in every export size.

export type FontId = 'bold' | 'classic' | 'rounded' | 'type' | 'poster' | 'light';
export type TextStyle = 'plain' | 'shadow' | 'outline' | 'box';
export type TextAlign = 'left' | 'center' | 'right';

export interface TextLayer {
  id: string;
  text: string;
  /** Centre, as fractions of frame width and height. */
  x: number;
  y: number;
  /** Font size as a fraction of frame width. */
  size: number;
  /** Radians. */
  rotation: number;
  color: string;
  font: FontId;
  style: TextStyle;
  align: TextAlign;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const FONTS: { id: FontId; label: string; weight: string; family: string }[] = [
  { id: 'bold', label: 'Bold', weight: '800', family: SANS },
  { id: 'classic', label: 'Classic', weight: 'italic 600', family: 'Georgia, "Times New Roman", serif' },
  { id: 'rounded', label: 'Round', weight: '700', family: `ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", ${SANS}` },
  { id: 'type', label: 'Type', weight: '700', family: '"Courier New", ui-monospace, Menlo, monospace' },
  { id: 'poster', label: 'Poster', weight: '900', family: `Impact, "Arial Black", "Helvetica Neue", ${SANS}` },
  { id: 'light', label: 'Light', weight: '300', family: SANS },
];

export const TEXT_COLORS = [
  '#ffffff',
  '#000000',
  '#ff3b5c',
  '#ff8a00',
  '#ffd60a',
  '#34c759',
  '#00c7be',
  '#0a84ff',
  '#bf5af2',
  '#ff9ecf',
];

export const TEXT_STYLES: { id: TextStyle; label: string }[] = [
  { id: 'plain', label: 'Plain' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'outline', label: 'Outline' },
  { id: 'box', label: 'Label' },
];

export function fontCss(font: FontId, px: number): string {
  const f = FONTS.find((x) => x.id === font) ?? FONTS[0];
  return `${f.weight} ${px}px ${f.family}`;
}

export function newTextLayer(id: string, text: string): TextLayer {
  return { id, text, x: 0.5, y: 0.5, size: 0.09, rotation: 0, color: '#ffffff', font: 'bold', style: 'shadow', align: 'center' };
}

/** Black or white, whichever reads better on `hex`. */
export function contrastColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#000000' : '#ffffff';
}

interface Metrics {
  lines: string[];
  widths: number[];
  px: number;
  lineHeight: number;
  /** Box size in frame pixels, unrotated, including style padding. */
  width: number;
  height: number;
}

function measure(ctx: CanvasRenderingContext2D, layer: TextLayer, W: number): Metrics {
  const px = Math.max(1, layer.size * W);
  ctx.font = fontCss(layer.font, px);
  const lines = layer.text.split('\n');
  const widths = lines.map((l) => ctx.measureText(l).width);
  const lineHeight = px * 1.18;
  const pad = layer.style === 'box' ? px * 0.32 : px * 0.08;
  return {
    lines,
    widths,
    px,
    lineHeight,
    width: Math.max(px * 0.5, ...widths) + pad * 2,
    height: lines.length * lineHeight + pad * 2,
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer, W: number, H: number): void {
  if (!layer.text.trim()) return;
  ctx.save();
  ctx.translate(layer.x * W, layer.y * H);
  ctx.rotate(layer.rotation);
  const m = measure(ctx, layer, W);
  const { px, lineHeight } = m;
  ctx.textBaseline = 'middle';
  ctx.textAlign = layer.align;
  ctx.lineJoin = 'round';
  const top = -(m.lines.length * lineHeight) / 2 + lineHeight / 2;
  const innerW = m.width - (layer.style === 'box' ? px * 0.64 : px * 0.16);
  const anchorX = layer.align === 'left' ? -innerW / 2 : layer.align === 'right' ? innerW / 2 : 0;

  if (layer.style === 'box') {
    ctx.fillStyle = layer.color;
    const padX = px * 0.32;
    const padY = px * 0.1;
    m.lines.forEach((line, i) => {
      if (!line.trim()) return;
      const w = m.widths[i];
      const left = layer.align === 'left' ? anchorX : layer.align === 'right' ? anchorX - w : -w / 2;
      roundRect(ctx, left - padX, top + i * lineHeight - lineHeight / 2 - padY, w + padX * 2, lineHeight + padY * 2, px * 0.28);
      ctx.fill();
    });
  }

  if (layer.style === 'shadow') {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = px * 0.18;
    ctx.shadowOffsetY = px * 0.04;
  }
  const fill = layer.style === 'box' ? contrastColor(layer.color) : layer.color;
  m.lines.forEach((line, i) => {
    const y = top + i * lineHeight;
    if (layer.style === 'outline') {
      ctx.strokeStyle = contrastColor(layer.color);
      ctx.lineWidth = px * 0.14;
      ctx.strokeText(line, anchorX, y);
    }
    ctx.fillStyle = fill;
    ctx.fillText(line, anchorX, y);
  });
  ctx.restore();
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Unrotated box size in frame pixels. */
export function textBox(layer: TextLayer, W: number): { width: number; height: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return { width: layer.size * W * 4, height: layer.size * W * 1.4 };
  const m = measure(measureCtx, layer, W);
  return { width: m.width, height: m.height };
}

/** Whether frame point (px, py) touches the layer, with `slop` extra pixels. */
export function hitText(layer: TextLayer, W: number, H: number, px: number, py: number, slop: number): boolean {
  const { width, height } = textBox(layer, W);
  const dx = px - layer.x * W;
  const dy = py - layer.y * H;
  const c = Math.cos(-layer.rotation);
  const s = Math.sin(-layer.rotation);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= width / 2 + slop && Math.abs(ly) <= height / 2 + slop;
}

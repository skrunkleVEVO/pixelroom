import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Analysis } from '../engine/Renderer';
import { outputSize } from '../engine/geometry';
import { imageRect, panes } from '../engine/view';
import { selectPhoto } from '../state/editor';
import { actions, activePhoto, getState, useStore, type CatalogPhoto } from '../state/store';
import { CropIcon, FlagIcon, GridIcon, LoupeIcon, CompareIcon, StarIcon, SplitIcon } from './Icons';
import { CropPanel } from './panels';

const HIST_W = 256;
const HIST_H = 96;

function drawHistogram(canvas: HTMLCanvasElement, a: Analysis | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  // Zone guides: blacks, shadows, exposure, highlights, whites.
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (const f of [0.2, 0.4, 0.6, 0.8]) ctx.fillRect(Math.round(f * w), 0, 1, h);
  if (!a) return;

  // Square root scale, ignoring the end bins: clipped pixels would flatten the rest.
  let peak = 1;
  for (const channel of [a.red, a.green, a.blue]) {
    for (let i = 1; i < 255; i++) peak = Math.max(peak, channel[i]);
  }
  const trace = (channel: Uint32Array, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < 256; i++) {
      const y = h - Math.min(1, Math.sqrt(channel[i] / peak)) * (h - 2);
      ctx.lineTo((i / 255) * w, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };
  ctx.globalCompositeOperation = 'lighter';
  trace(a.red, 'rgb(190,50,50)');
  trace(a.green, 'rgb(50,160,60)');
  trace(a.blue, 'rgb(55,85,200)');
  ctx.globalCompositeOperation = 'source-over';
}

function fnum(v: number | undefined): string {
  return v === undefined ? '--' : `${(v / 2.55).toFixed(1)}`;
}

export function Histogram() {
  const analysis = useStore((s) => s.analysis);
  const readout = useStore((s) => s.readout);
  const clipping = useStore((s) => s.showClipping);
  const photo = useStore(activePhoto);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (ref.current) drawHistogram(ref.current, analysis);
  }, [analysis]);

  const exif = photo?.exif;
  return (
    <div className="histogram">
      <div className="hist-graph">
        <canvas ref={ref} width={HIST_W} height={HIST_H} role="img" aria-label="Histogram of the edited photo" />
        <button
          className={`clip-flag low${clipping || (analysis?.clipLow ?? 0) > 0.002 ? ' lit' : ''}`}
          aria-label="Show clipping"
          aria-pressed={clipping}
          title="Show clipping (J)"
          onClick={actions.toggleClipping}
        />
        <button
          className={`clip-flag high${clipping || (analysis?.clipHigh ?? 0) > 0.002 ? ' lit' : ''}`}
          aria-label="Show clipping"
          aria-pressed={clipping}
          title="Show clipping (J)"
          onClick={actions.toggleClipping}
        />
      </div>
      {readout ? (
        <div className="hist-info rgb">
          <span>R {fnum(readout[0])}</span>
          <span>G {fnum(readout[1])}</span>
          <span>B {fnum(readout[2])}</span>
          <span>%</span>
        </div>
      ) : (
        <div className="hist-info">
          <span>{exif?.iso ? `ISO ${exif.iso}` : photo ? `${photo.width} x ${photo.height}` : ''}</span>
          <span>{exif?.focal}</span>
          <span>{exif?.aperture}</span>
          <span>{exif?.shutter}</span>
        </div>
      )}
    </div>
  );
}

export function ToolStrip() {
  const tool = useStore((s) => s.tool);
  const hasPhoto = useStore((s) => s.activeId !== null);
  return (
    <>
      <div className="tool-strip">
        <button
          className={`strip-button${tool === 'crop' ? ' on' : ''}`}
          disabled={!hasPhoto}
          aria-label="Crop and straighten"
          aria-pressed={tool === 'crop'}
          title="Crop and straighten (R)"
          onClick={() => actions.setTool(tool === 'crop' ? 'none' : 'crop')}
        >
          <CropIcon />
        </button>
      </div>
      {tool === 'crop' && <CropPanel />}
    </>
  );
}

const ZOOMS: { label: string; zoom: 'fit' | 'fill' | number }[] = [
  { label: 'Fit', zoom: 'fit' },
  { label: 'Fill', zoom: 'fill' },
  { label: '1:1', zoom: 1 },
  { label: '2:1', zoom: 2 },
];

/** Thumbnail with the visible area marked; drag to move around the photo. */
export function Navigator() {
  const photo = useStore(activePhoto);
  const view = useStore((s) => s.view);
  const stage = useStore((s) => s.stage);
  const compare = useStore((s) => s.compare);
  const geometry = useStore((s) => s.params.geometry);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const box = useMemo(() => {
    if (!photo || view.zoom === 'fit') return null;
    const out = outputSize(geometry, photo.width, photo.height);
    const pane = panes(Math.round(stage.width * stage.dpr), Math.round(stage.height * stage.dpr), compare === 'side').slice(-1)[0];
    const rect = imageRect(view, out.width, out.height, pane, 0);
    const w = Math.min(1, pane.w / rect.w);
    const h = Math.min(1, pane.h / rect.h);
    return {
      left: `${(Math.max(0, pane.x - rect.x) / rect.w) * 100}%`,
      top: `${(Math.max(0, pane.y - rect.y) / rect.h) * 100}%`,
      width: `${w * 100}%`,
      height: `${h * 100}%`,
    };
  }, [photo, view, stage, compare, geometry]);

  const moveTo = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const cy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const { zoom } = getState().view;
    // Clicking the thumbnail while fitted jumps to that spot at 1:1.
    actions.setView({ zoom: zoom === 'fit' ? 1 : zoom, cx, cy });
  };

  const isZoom = (z: 'fit' | 'fill' | number) => view.zoom === z;
  const custom = typeof view.zoom === 'number' && !ZOOMS.some((z) => z.zoom === view.zoom);

  return (
    <section className="panel navigator">
      <header className="panel-head static">
        <span className="panel-title">Navigator</span>
        <span className="zoom-buttons" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button key={z.label} className={isZoom(z.zoom) ? 'on' : ''} disabled={!photo} onClick={() => actions.setView({ ...getState().view, zoom: z.zoom })}>
              {z.label}
            </button>
          ))}
          {custom && <span className="zoom-custom">{Math.round((view.zoom as number) * 100)}%</span>}
        </span>
      </header>
      <div className="nav-well">
        {photo?.thumb && (
          <div
            ref={ref}
            className="nav-image"
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              moveTo(e);
            }}
            onPointerMove={(e) => dragging.current && moveTo(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            <img src={photo.thumb} alt="" draggable={false} />
            {box && <div className="nav-box" style={box} />}
          </div>
        )}
      </div>
    </section>
  );
}

function Stars({ value, onChange }: { value: number; onChange?: (rating: number) => void }) {
  return (
    <span className="stars" role={onChange ? 'group' : undefined} aria-label={onChange ? 'Rating' : `${value} stars`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} className={n <= value ? 'on' : ''} aria-label={`${n} star${n > 1 ? 's' : ''}`} title={`Rate ${n} (${n})`} onClick={() => onChange(n === value ? 0 : n)}>
            <StarIcon />
          </button>
        ) : (
          <i key={n} className={n <= value ? 'on' : ''}>
            <StarIcon />
          </i>
        ),
      )}
    </span>
  );
}

export function Toolbar() {
  const module = useStore((s) => s.module);
  const compare = useStore((s) => s.compare);
  const photo = useStore(activePhoto);
  return (
    <div className="toolbar">
      {module === 'library' ? (
        <button className="strip-button on" aria-label="Grid view" title="Grid (G)">
          <GridIcon />
        </button>
      ) : (
        <>
          <button className={`strip-button${compare === 'off' ? ' on' : ''}`} aria-label="Loupe view" title="Loupe (D)" onClick={() => compare === 'side' && actions.toggleCompare()}>
            <LoupeIcon />
          </button>
          <button
            className={`strip-button${compare === 'side' ? ' on' : ''}`}
            disabled={!photo}
            aria-label="Before and after"
            aria-pressed={compare === 'side'}
            title="Before / After (Y)"
            onClick={actions.toggleCompare}
          >
            <SplitIcon />
          </button>
          <button
            className="strip-button"
            disabled={!photo}
            aria-label="Hold to see the original"
            title="Hold to see the original (\)"
            onPointerDown={() => actions.setPeek(true)}
            onPointerUp={() => actions.setPeek(false)}
            onPointerLeave={() => actions.setPeek(false)}
            onPointerCancel={() => actions.setPeek(false)}
          >
            <CompareIcon />
          </button>
        </>
      )}
      <span className="toolbar-sep" />
      {photo && (
        <>
          <button
            className={`strip-button flag${photo.flag === 'pick' ? ' on' : ''}`}
            aria-label="Flag as pick"
            aria-pressed={photo.flag === 'pick'}
            title="Flag as pick (P)"
            onClick={() => actions.setFlag(photo.flag === 'pick' ? null : 'pick')}
          >
            <FlagIcon />
          </button>
          <button
            className={`strip-button flag reject${photo.flag === 'reject' ? ' on' : ''}`}
            aria-label="Flag as rejected"
            aria-pressed={photo.flag === 'reject'}
            title="Set as rejected (X)"
            onClick={() => actions.setFlag(photo.flag === 'reject' ? null : 'reject')}
          >
            <FlagIcon />
          </button>
          <Stars value={photo.rating} onChange={actions.setRating} />
          <span className="toolbar-name">
            {photo.name}
            {photo.exif.camera ? ` · ${photo.exif.camera}` : ''}
          </span>
        </>
      )}
    </div>
  );
}

function PhotoCell({ photo, active, showName }: { photo: CatalogPhoto; active: boolean; showName: boolean }) {
  return (
    <button
      className={`photo-cell${active ? ' on' : ''}${photo.flag === 'reject' ? ' rejected' : ''}`}
      aria-label={photo.name}
      aria-current={active}
      title={photo.name}
      onClick={() => void selectPhoto(photo.id)}
      onDoubleClick={() => actions.setModule('develop')}
    >
      <span className="cell-image">{photo.thumb ? <img src={photo.thumb} alt="" draggable={false} /> : <span className="cell-loading" />}</span>
      {photo.flag && (
        <span className={`cell-flag ${photo.flag}`}>
          <FlagIcon />
        </span>
      )}
      {showName && (
        <span className="cell-foot">
          <span className="cell-name">{photo.name}</span>
          <Stars value={photo.rating} />
        </span>
      )}
      {!showName && photo.rating > 0 && <span className="cell-rating">{'★'.repeat(photo.rating)}</span>}
    </button>
  );
}

export function Filmstrip() {
  const catalog = useStore((s) => s.catalog);
  const activeId = useStore((s) => s.activeId);
  const stripRef = useRef<HTMLDivElement>(null);

  // Vertical wheel scrolls the strip sideways.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX) return;
      e.preventDefault();
      strip.scrollLeft += e.deltaY;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="filmstrip">
      <div className="film-info">
        <span>{catalog.length} photo{catalog.length === 1 ? '' : 's'}</span>
      </div>
      <div className="film-cells" ref={stripRef}>
        {catalog.map((photo) => (
          <PhotoCell key={photo.id} photo={photo} active={photo.id === activeId} showName={false} />
        ))}
      </div>
    </div>
  );
}

export function LibraryGrid() {
  const catalog = useStore((s) => s.catalog);
  const activeId = useStore((s) => s.activeId);
  const [size, setSize] = useState(190);
  return (
    <div className="library">
      <div className="library-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
        {catalog.map((photo) => (
          <PhotoCell key={photo.id} photo={photo} active={photo.id === activeId} showName />
        ))}
      </div>
      <label className="library-size">
        Thumbnails
        <input type="range" min={110} max={360} value={size} onChange={(e) => setSize(Number(e.target.value))} />
      </label>
    </div>
  );
}

export function LibraryInfo() {
  const photo = useStore(activePhoto);
  if (!photo) return <p className="muted-note">No photo selected.</p>;
  const { exif } = photo;
  const rows: [string, string | undefined][] = [
    ['File Name', photo.name],
    ['Dimensions', `${photo.width} x ${photo.height}`],
    ['Camera', exif.camera],
    ['Lens', exif.lens],
    ['Captured', exif.date],
    ['ISO', exif.iso ? `${exif.iso}` : undefined],
    ['Exposure', exif.shutter],
    ['Aperture', exif.aperture],
    ['Focal Length', exif.focal],
  ];
  return (
    <dl className="meta-list">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

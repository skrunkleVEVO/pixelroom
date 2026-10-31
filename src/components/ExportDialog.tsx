import { useEffect, useState, type ReactNode } from 'react';
import type { ExportOptions } from '../engine/Renderer';
import { outputSize } from '../engine/geometry';
import { downloadBlob, exportPhoto, type ExportRequest } from '../state/editor';
import { actions, activePhoto, useStore } from '../state/store';
import { Slider } from './Slider';

const FORMATS: { type: ExportOptions['type']; label: string; lossy: boolean }[] = [
  { type: 'image/jpeg', label: 'JPEG', lossy: true },
  { type: 'image/png', label: 'PNG', lossy: false },
  { type: 'image/webp', label: 'WebP', lossy: true },
];

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="export-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const photo = useStore(activePhoto);
  const geometry = useStore((s) => s.params.geometry);
  const [type, setType] = useState<ExportOptions['type']>('image/jpeg');
  const [quality, setQuality] = useState(95);
  const [resize, setResize] = useState(false);
  const [longEdge, setLongEdge] = useState(2048);
  const [metadata, setMetadata] = useState<ExportRequest['metadata']>('noLocation');
  const [name, setName] = useState(() => photo?.name.replace(/\.[^.]+$/, '') ?? 'photo');
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  if (!photo) return null;
  const format = FORMATS.find((f) => f.type === type) ?? FORMATS[0];
  const size = outputSize(geometry, photo.width, photo.height);
  const long = Math.max(size.width, size.height);
  const limit = resize && longEdge > 0 && longEdge < long ? longEdge / long : 1;
  const finalW = Math.max(1, Math.round(size.width * limit));
  const finalH = Math.max(1, Math.round(size.height * limit));
  const hasExif = !!photo.exifRaw && type === 'image/jpeg';

  const run = async () => {
    setProgress(0);
    try {
      const blob = await exportPhoto({
        type,
        quality: quality / 100,
        longEdge: resize && longEdge > 0 ? longEdge : undefined,
        metadata,
        onProgress: setProgress,
      });
      // Browsers without an encoder for the type silently return PNG, so name by result.
      downloadBlob(blob, `${name.trim() || 'photo'}.${EXTENSIONS[blob.type] ?? 'png'}`);
      const mb = (blob.size / 1048576).toFixed(1);
      const note = blob.type !== type ? ' This browser cannot encode that format, so it saved a PNG.' : '';
      actions.notify(`Exported ${finalW} x ${finalH} (${mb} MB).${note}`);
      onClose();
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : 'Export failed.', true);
      setProgress(null);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onPointerDown={(e) => e.stopPropagation()}>
        <h2 id="export-title">Export One File</h2>

        <Group title="File Naming">
          <label className="export-row">
            <span>File Name</span>
            <span className="name-field">
              <input value={name} disabled={busy} aria-label="File name" onChange={(e) => setName(e.target.value)} />
              <span className="muted-note">.{EXTENSIONS[type]}</span>
            </span>
          </label>
        </Group>

        <Group title="File Settings">
          <label className="export-row">
            <span>Image Format</span>
            <select value={type} disabled={busy} onChange={(e) => setType(e.target.value as ExportOptions['type'])}>
              {FORMATS.map((f) => (
                <option key={f.type} value={f.type}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {format.lossy && (
            <Slider label="Quality" value={quality} range={[10, 100]} resetValue={95} format={(v) => `${v}`} onChange={setQuality} onCommit={() => undefined} />
          )}
          <div className="export-row static">
            <span>Color Space</span>
            <span>sRGB, 8 bits/channel</span>
          </div>
          {type === 'image/jpeg' && (
            <div className="export-row static">
              <span>Chroma</span>
              <span>Full color (4:4:4)</span>
            </div>
          )}
          {type === 'image/webp' && <p className="muted-note">WebP reduces color resolution unless Quality is 100, which is lossless.</p>}
        </Group>

        <Group title="Image Sizing">
          <label className="export-row check">
            <input type="checkbox" checked={resize} disabled={busy} onChange={(e) => setResize(e.target.checked)} />
            <span>Resize to Fit: Long Edge</span>
            <input
              className="number-field"
              type="number"
              min={16}
              max={65535}
              value={longEdge}
              disabled={busy || !resize}
              aria-label="Long edge in pixels"
              onChange={(e) => setLongEdge(Number(e.target.value))}
            />
            <span>pixels</span>
          </label>
          <div className="export-row static">
            <span>Output Size</span>
            <span>
              {finalW} x {finalH} px{limit === 1 && !resize ? ', full resolution' : ''}
            </span>
          </div>
        </Group>

        <Group title="Metadata">
          <label className="export-row">
            <span>Include</span>
            <select value={metadata} disabled={busy || !hasExif} onChange={(e) => setMetadata(e.target.value as ExportRequest['metadata'])}>
              <option value="noLocation">All, Except Location</option>
              <option value="all">All Metadata</option>
              <option value="none">None</option>
            </select>
          </label>
          {!hasExif && <p className="muted-note">{type === 'image/jpeg' ? 'This photo has no camera metadata.' : 'Metadata is only kept in JPEG exports.'}</p>}
        </Group>

        {busy && (
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <div className="modal-actions">
          <button className="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" onClick={run} disabled={busy}>
            {busy ? (progress >= 0.9 ? 'Encoding...' : `Rendering ${Math.round(progress * 100)}%`) : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { ExportOptions } from '../engine/Renderer';
import { downloadBlob, exportPhoto } from '../state/editor';
import { actions, useStore } from '../state/store';
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

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const photo = useStore((s) => s.photo);
  const [type, setType] = useState<ExportOptions['type']>('image/jpeg');
  const [quality, setQuality] = useState(92);
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

  const run = async () => {
    setProgress(0);
    try {
      const blob = await exportPhoto({ type, quality: quality / 100, onProgress: setProgress });
      // Browsers without an encoder for the type silently return PNG, so name by result.
      const base = photo.name.replace(/\.[^.]+$/, '');
      downloadBlob(blob, `${base}-pixelroom.${EXTENSIONS[blob.type] ?? 'png'}`);
      const mb = (blob.size / 1048576).toFixed(1);
      const note = blob.type !== type ? ' This browser cannot encode that format, so it saved a PNG.' : '';
      actions.notify(`Exported ${photo.width} × ${photo.height} (${mb} MB).${note}`);
      onClose();
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : 'Export failed.', true);
      setProgress(null);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 id="export-title">Export photo</h2>
        <p className="modal-note">
          Full resolution: {photo.width} × {photo.height} px
        </p>
        <div className="segmented" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button
              key={f.type}
              role="radio"
              aria-checked={f.type === type}
              className={f.type === type ? 'active' : ''}
              disabled={busy}
              onClick={() => setType(f.type)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {format.lossy && (
          <Slider
            label="Quality"
            value={quality}
            range={[10, 100]}
            resetValue={92}
            format={(v) => `${v}`}
            onChange={setQuality}
            onCommit={() => undefined}
          />
        )}
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
            {busy ? `Rendering ${Math.round(progress * 100)}%` : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

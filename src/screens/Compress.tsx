// Batch compression: pick photos, choose a size and quality, save them all.
import { useEffect, useRef, useState } from 'react';
import {
  FORMAT_INFO,
  QUALITIES,
  availableFormats,
  baseName,
  encodeWith,
  formatBytes,
  type OutFormat,
  type QualityId,
} from '../lib/encode';
import { closeImage, decodeFile, fitWithin, isImageFile, releaseCanvas, resizeTo } from '../lib/image';
import { canShareFiles, downloadBlob, shareFiles } from '../lib/save';
import { loadSetting, saveSetting } from '../lib/settings';
import { buildZip, uniqueNames } from '../lib/zip';
import * as I from '../ui/Icons';

const MAX_EDGES = [
  { value: 0, label: 'Original' },
  { value: 4096, label: '4K' },
  { value: 2048, label: '2048' },
  { value: 1080, label: '1080' },
  { value: 720, label: '720' },
];

interface Prefs {
  edge: number;
  format: OutFormat;
  quality: QualityId;
}

const DEFAULTS: Prefs = { edge: 2048, format: 'jpeg', quality: 'medium' };

interface Item {
  id: number;
  file: File;
  status: 'waiting' | 'working' | 'done' | 'error';
  out?: File;
  width?: number;
  height?: number;
  url?: string;
  /** The original was already smaller than any result. */
  kept?: boolean;
  error?: string;
}

let nextId = 1;

export function Compress({ initialFiles, onBack }: { initialFiles: File[]; onBack: () => void }) {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = { ...DEFAULTS, ...loadSetting<Partial<Prefs>>('compress', {}) };
    if (!availableFormats().includes(p.format)) p.format = 'jpeg';
    return p;
  });
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const add = (files: File[]) => {
    const images = files.filter(isImageFile);
    if (images.length < files.length) setMessage('Some files were skipped because they are not images.');
    setItems((old) => [...old, ...images.map((file) => ({ id: nextId++, file, status: 'waiting' as const }))]);
  };

  useEffect(() => {
    if (initialFiles.length) add(initialFiles);
    return () => itemsRef.current.forEach((i) => i.url && URL.revokeObjectURL(i.url));
  }, []);

  const update = (p: Partial<Prefs>) =>
    setPrefs((old) => {
      const next = { ...old, ...p };
      saveSetting('compress', next);
      return next;
    });

  // Settings changed after a run: results are stale.
  useEffect(() => {
    setItems((old) =>
      old.map((i) => {
        if (i.status === 'waiting') return i;
        if (i.url) URL.revokeObjectURL(i.url);
        return { id: i.id, file: i.file, status: 'waiting' };
      }),
    );
  }, [prefs]);

  const setItem = (id: number, p: Partial<Item>) => setItems((old) => old.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const run = async () => {
    setRunning(true);
    setMessage(null);
    const info = FORMAT_INFO[prefs.format];
    for (const item of itemsRef.current) {
      if (item.status === 'done') continue;
      setItem(item.id, { status: 'working' });
      try {
        const decoded = await decodeFile(item.file);
        const [w, h] = prefs.edge ? fitWithin(decoded.width, decoded.height, prefs.edge) : [decoded.width, decoded.height];
        const canvas = resizeTo(decoded.image, w, h);
        closeImage(decoded.image);
        const result = await encodeWith(canvas, prefs.format, prefs.quality);
        releaseCanvas(canvas);
        const sameShape = result.width === decoded.width && result.height === decoded.height;
        const sameType = item.file.type === info.mime;
        // Never hand back a bigger file of the same kind.
        const keep = sameShape && sameType && result.blob.size >= item.file.size;
        const out = keep
          ? item.file
          : new File([result.blob], `${baseName(item.file.name)}-small.${info.ext}`, { type: info.mime });
        setItem(item.id, {
          status: 'done',
          out,
          kept: keep,
          width: keep ? decoded.width : result.width,
          height: keep ? decoded.height : result.height,
          url: URL.createObjectURL(out),
        });
      } catch (e) {
        setItem(item.id, { status: 'error', error: e instanceof Error ? e.message : 'Failed.' });
      }
    }
    setRunning(false);
  };

  const done = items.filter((i) => i.status === 'done' && i.out);
  const outFiles = done.map((i) => i.out!);
  const totalIn = done.reduce((n, i) => n + i.file.size, 0);
  const totalOut = done.reduce((n, i) => n + i.out!.size, 0);
  const pending = items.some((i) => i.status === 'waiting' || i.status === 'error');
  const shareable = outFiles.length > 0 && canShareFiles(outFiles);

  const shareAll = async () => {
    try {
      if (await shareFiles(outFiles)) setMessage('Shared!');
    } catch {
      setMessage('Sharing failed here — use Download instead.');
    }
  };
  const downloadAll = async () => {
    if (outFiles.length === 1) return downloadBlob(outFiles[0], outFiles[0].name);
    const names = uniqueNames(outFiles.map((f) => f.name));
    const entries = await Promise.all(
      outFiles.map(async (f, i) => ({ name: names[i], data: new Uint8Array(await f.arrayBuffer()) })),
    );
    downloadBlob(new Blob([buildZip(entries)], { type: 'application/zip' }), `photos-${outFiles.length}.zip`);
  };
  const shareOne = async (file: File) => {
    try {
      if (canShareFiles([file])) await shareFiles([file]);
      else downloadBlob(file, file.name);
    } catch {
      downloadBlob(file, file.name);
    }
  };
  const remove = (id: number) =>
    setItems((old) =>
      old.filter((i) => {
        if (i.id === id && i.url) URL.revokeObjectURL(i.url);
        return i.id !== id;
      }),
    );

  return (
    <div className="screen compress">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={onBack} disabled={running}>
          <I.Back />
        </button>
        <h1 className="topbar-title">Compress</h1>
        <button className="icon-btn" aria-label="Add photos" onClick={() => inputRef.current?.click()} disabled={running}>
          <I.Plus />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </header>

      <div className="compress-body">
        <section className="card settings">
          <div className="field">
            <span className="field-label">Max size (long edge)</span>
            <div className="segmented">
              {MAX_EDGES.map((m) => (
                <button key={m.value} className={prefs.edge === m.value ? 'is-on' : ''} onClick={() => update({ edge: m.value })}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Format</span>
            <div className="segmented">
              {availableFormats().map((f) => (
                <button key={f} className={prefs.format === f ? 'is-on' : ''} onClick={() => update({ format: f })}>
                  {FORMAT_INFO[f].label}
                </button>
              ))}
            </div>
          </div>
          {prefs.format !== 'png' && (
            <div className="field">
              <span className="field-label">Quality / file size</span>
              <div className="chips">
                {QUALITIES.map((q) => (
                  <button key={q.id} className={prefs.quality === q.id ? 'chip is-on' : 'chip'} onClick={() => update({ quality: q.id })}>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {items.length === 0 ? (
          <button className="dropzone" onClick={() => inputRef.current?.click()}>
            <I.ImageIcon size={36} />
            <strong>Choose photos</strong>
            <span>Pick as many as you like. They never leave your phone.</span>
          </button>
        ) : (
          <ul className="results">
            {items.map((i) => (
              <li key={i.id} className="result">
                <div className="result-thumb">
                  {i.url ? <img src={i.url} alt="" /> : i.status === 'working' ? <div className="spinner small" /> : <I.ImageIcon />}
                </div>
                <div className="result-text">
                  <span className="result-name">{i.file.name}</span>
                  <span className="result-meta">
                    {i.status === 'done' && i.out ? (
                      i.kept ? (
                        <>{formatBytes(i.file.size)} · already small, kept as is</>
                      ) : (
                        <>
                          {formatBytes(i.file.size)} → <strong>{formatBytes(i.out.size)}</strong>{' '}
                          <span className="saving">−{Math.max(0, Math.round((1 - i.out.size / i.file.size) * 100))}%</span>
                          {' · '}
                          {i.width}×{i.height}
                        </>
                      )
                    ) : i.status === 'error' ? (
                      <span className="error">{i.error}</span>
                    ) : i.status === 'working' ? (
                      'Compressing…'
                    ) : (
                      formatBytes(i.file.size)
                    )}
                  </span>
                </div>
                {i.status === 'done' && i.out ? (
                  <button className="icon-btn" aria-label={`Save ${i.file.name}`} onClick={() => shareOne(i.out!)}>
                    <I.Share size={20} />
                  </button>
                ) : (
                  <button className="icon-btn" aria-label={`Remove ${i.file.name}`} disabled={running} onClick={() => remove(i.id)}>
                    <I.Close size={20} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length > 0 && (
        <footer className="compress-footer">
          {done.length > 0 && (
            <p className="summary">
              {done.length} photo{done.length === 1 ? '' : 's'}: {formatBytes(totalIn)} → <strong>{formatBytes(totalOut)}</strong>
              {totalIn > 0 && <span className="saving"> −{Math.max(0, Math.round((1 - totalOut / totalIn) * 100))}%</span>}
            </p>
          )}
          {message && <p className="hint center">{message}</p>}
          <div className="sheet-actions">
            {pending || running ? (
              <button className="btn btn-primary grow" disabled={running} onClick={run}>
                {running ? (
                  <>
                    <span className="spinner small inline" /> Compressing…
                  </>
                ) : (
                  <>
                    <I.Shrink size={20} /> Compress {items.filter((i) => i.status !== 'done').length}
                  </>
                )}
              </button>
            ) : (
              <>
                {shareable && (
                  <button className="btn btn-primary grow" onClick={shareAll}>
                    <I.Share size={20} /> Save all
                  </button>
                )}
                <button className={shareable ? 'btn grow' : 'btn btn-primary grow'} onClick={downloadAll}>
                  <I.Download size={20} /> {outFiles.length > 1 ? 'Download .zip' : 'Download'}
                </button>
              </>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

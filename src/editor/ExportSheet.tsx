// Save / share. The file is rendered and encoded as soon as the sheet opens (and
// again when a setting changes), so the Share button can hand it over instantly:
// browsers only allow the share sheet right after a tap.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FORMAT_INFO,
  QUALITIES,
  availableFormats,
  formatBytes,
  baseName,
  encodeWith,
  stamp,
  type Encoded,
  type OutFormat,
  type QualityId,
} from '../lib/encode';
import { releaseCanvas } from '../lib/image';
import { SIZE_MODES, type SizeMode } from '../lib/layout';
import { canShareFiles, downloadBlob, isIos, shareFiles } from '../lib/save';
import { loadSetting, saveSetting } from '../lib/settings';
import { useStore } from '../lib/store';
import * as I from '../ui/Icons';
import { exportSize, renderFrame } from './render';
import { editor, patch } from './state';

interface Prefs {
  size: SizeMode;
  format: OutFormat;
  quality: QualityId;
}

const DEFAULTS: Prefs = { size: 'social', format: 'jpeg', quality: 'high' };

export function ExportSheet() {
  const photo = useStore(editor, (s) => s.photo)!;
  const doc = useStore(editor, (s) => s.doc);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = { ...DEFAULTS, ...loadSetting<Partial<Prefs>>('export', {}) };
    if (!availableFormats().includes(p.format)) p.format = 'jpeg';
    return p;
  });
  const [result, setResult] = useState<Encoded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [frame, setFrame] = useState<HTMLCanvasElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const frameRef = useRef<HTMLCanvasElement | null>(null);

  const update = (p: Partial<Prefs>) =>
    setPrefs((old) => {
      const next = { ...old, ...p };
      saveSetting('export', next);
      return next;
    });

  // Render the frame when the size changes.
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    // Let the spinner paint before the (synchronous) render.
    const timer = setTimeout(() => {
      try {
        const canvas = renderFrame(photo, doc, prefs.size);
        if (cancelled) return releaseCanvas(canvas);
        if (frameRef.current) releaseCanvas(frameRef.current);
        frameRef.current = canvas;
        setFrame(canvas);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Rendering failed.');
        setBusy(false);
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [photo, doc, prefs.size]);

  // Encode when the frame, format or quality changes.
  useEffect(() => {
    if (!frame) return;
    let cancelled = false;
    setBusy(true);
    encodeWith(frame, prefs.format, prefs.quality)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Saving failed.'))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [frame, prefs.format, prefs.quality]);

  useEffect(() => () => {
    if (frameRef.current) releaseCanvas(frameRef.current);
  }, []);

  const previewUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const file = useMemo(() => {
    if (!result) return null;
    const info = FORMAT_INFO[prefs.format];
    return new File([result.blob], `${baseName(photo.name)}-${stamp()}.${info.ext}`, { type: info.mime });
  }, [result, prefs.format, photo.name]);

  const shareable = file ? canShareFiles([file]) : false;
  const close = () => patch({ exportOpen: false });

  const share = async () => {
    if (!file) return;
    try {
      if (await shareFiles([file])) setMessage('Shared!');
    } catch {
      downloadBlob(file, file.name);
      setMessage('Saved to Downloads.');
    }
  };
  const download = () => {
    if (!file) return;
    downloadBlob(file, file.name);
    setMessage(isIos() ? 'Check Files → Downloads.' : 'Saved to Downloads.');
  };

  const formats = availableFormats();
  const qualityOptions = prefs.format === 'png' ? [] : QUALITIES;
  const shrunk = result && frame && (result.width !== frame.width || result.height !== frame.height);

  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet" role="dialog" aria-label="Save photo" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Save</h2>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <I.Close />
          </button>
        </div>

        <div className="export-preview">
          {previewUrl && <img src={previewUrl} alt="Result preview" />}
          {busy && <div className="spinner" aria-label="Working" />}
        </div>
        <p className="export-info" aria-live="polite">
          {error ? (
            <span className="error">{error}</span>
          ) : result ? (
            <>
              <strong>{formatBytes(result.blob.size)}</strong> · {result.width} × {result.height} ·{' '}
              {FORMAT_INFO[prefs.format].label}
              {shrunk && ' · shrunk to fit'}
            </>
          ) : (
            'Preparing…'
          )}
        </p>

        <div className="field">
          <span className="field-label">Size</span>
          <div className="segmented">
            {SIZE_MODES.map((m) => {
              const [w, h] = exportSize(photo, doc, m.id);
              return (
                <button key={m.id} className={prefs.size === m.id ? 'is-on' : ''} onClick={() => update({ size: m.id })}>
                  {m.label}
                  <small>
                    {w}×{h}
                  </small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Format</span>
          <div className="segmented">
            {formats.map((f) => (
              <button key={f} className={prefs.format === f ? 'is-on' : ''} onClick={() => update({ format: f })}>
                {FORMAT_INFO[f].label}
              </button>
            ))}
          </div>
        </div>

        {qualityOptions.length > 0 && (
          <div className="field">
            <span className="field-label">Quality / file size</span>
            <div className="chips">
              {qualityOptions.map((q) => (
                <button key={q.id} className={prefs.quality === q.id ? 'chip is-on' : 'chip'} onClick={() => update({ quality: q.id })}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sheet-actions">
          {shareable && (
            <button className="btn btn-primary grow" disabled={!file || busy} onClick={share}>
              <I.Share size={20} /> {isIos() ? 'Share / Save to Photos' : 'Share'}
            </button>
          )}
          <button className={shareable ? 'btn grow' : 'btn btn-primary grow'} disabled={!file || busy} onClick={download}>
            <I.Download size={20} /> Download
          </button>
        </div>
        <p className="hint center">
          {message ??
            (shareable && isIos()
              ? 'Tip: tap Share, then “Save Image” to put it in Photos — or pick Instagram or TikTok directly.'
              : 'Location and camera data are removed from saved photos.')}
        </p>
      </div>
    </div>
  );
}

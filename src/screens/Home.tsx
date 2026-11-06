import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { isImageFile } from '../lib/image';
import { isTouchDevice } from '../lib/save';
import { promptInstall, useInstallMode } from '../pwa';
import * as I from '../ui/Icons';

interface Props {
  onEdit: (file: File) => void;
  onCompress: (files: File[]) => void;
  onCollage: (files: File[]) => void;
  onSample: () => void;
  error: string | null;
}

export function Home({ onEdit, onCompress, onCollage, onSample, error }: Props) {
  const editInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const compressInput = useRef<HTMLInputElement>(null);
  const collageInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const install = useInstallMode();
  const touch = isTouchDevice();

  // Desktop conveniences: paste or drop a photo anywhere.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
      if (files.length === 1) onEdit(files[0]);
      else if (files.length > 1) onCompress(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onEdit, onCompress]);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files].filter(isImageFile);
    if (files.length === 1) onEdit(files[0]);
    else if (files.length > 1) onCompress(files);
  };

  const pickOne = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onEdit(file);
  };

  return (
    <div
      className={dragging ? 'screen home is-dragging' : 'screen home'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <div className="home-inner">
        <header className="brand">
          <div className="logo" aria-hidden="true">
            <span />
          </div>
          <h1>PixelRoom</h1>
          <p>Edit, resize and shrink photos for posts, stories and TikTok. Everything stays on your device.</p>
        </header>

        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          <button className="action action-main" onClick={() => editInput.current?.click()}>
            <span className="action-icon">
              <I.ImageIcon size={28} />
            </span>
            <span className="action-text">
              <strong>Edit a photo</strong>
              <small>Crop to 4:5, 9:16, 1:1 · filters · text</small>
            </span>
          </button>
          <button className="action" onClick={() => collageInput.current?.click()}>
            <span className="action-icon">
              <I.Grid size={26} />
            </span>
            <span className="action-text">
              <strong>Make a collage</strong>
              <small>2–10 photos in one post</small>
            </span>
          </button>
          {touch && (
            <button className="action" onClick={() => cameraInput.current?.click()}>
              <span className="action-icon">
                <I.Camera size={26} />
              </span>
              <span className="action-text">
                <strong>Take a photo</strong>
                <small>Shoot, then edit</small>
              </span>
            </button>
          )}
          <button className="action" onClick={() => compressInput.current?.click()}>
            <span className="action-icon">
              <I.Shrink size={26} />
            </span>
            <span className="action-text">
              <strong>Compress photos</strong>
              <small>Make many photos smaller at once</small>
            </span>
          </button>
        </div>

        <input ref={editInput} type="file" accept="image/*" hidden onChange={pickOne} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={pickOne} />
        <input
          ref={collageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])].filter(isImageFile);
            e.target.value = '';
            if (files.length) onCollage(files);
          }}
        />
        <input
          ref={compressInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) onCompress(files);
          }}
        />

        <div className="home-foot">
          <button className="link" onClick={onSample}>
            No photo handy? Try a sample
          </button>
          {!touch && <p className="hint">Tip: drop or paste a photo anywhere on this page.</p>}
          {install === 'prompt' && (
            <button className="btn install" onClick={promptInstall}>
              <I.Phone size={20} /> Install app
            </button>
          )}
          {install === 'ios' && (
            <p className="hint install-hint">
              <I.Share size={16} /> To install: tap Share, then “Add to Home Screen”.
            </p>
          )}
        </div>
      </div>
      {dragging && <div className="drop-overlay">Drop photos here</div>}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Editor } from './editor/Editor';
import { closePhoto, openCanvas, openFile } from './editor/state';
import { createSampleScene } from './sample';
import { Compress } from './screens/Compress';
import { Home } from './screens/Home';
import { takeSharedFiles } from './shareTarget';

type Screen = { name: 'home' } | { name: 'editor' } | { name: 'compress'; files: File[] } | { name: 'loading' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [error, setError] = useState<string | null>(null);

  const edit = useCallback(async (file: File) => {
    setError(null);
    setScreen({ name: 'loading' });
    try {
      await openFile(file);
      setScreen({ name: 'editor' });
    } catch (e) {
      setError(e instanceof Error ? e.message : "This photo couldn't be opened.");
      setScreen({ name: 'home' });
    }
  }, []);

  const compress = useCallback((files: File[]) => {
    setError(null);
    setScreen({ name: 'compress', files });
  }, []);

  const sample = useCallback(() => {
    openCanvas(createSampleScene(2400, 1600), 'sample');
    setScreen({ name: 'editor' });
  }, []);

  const home = useCallback(() => {
    closePhoto();
    setScreen({ name: 'home' });
  }, []);

  // Photos shared into the installed app from the gallery (Android).
  useEffect(() => {
    takeSharedFiles().then((files) => {
      if (files.length === 1) void edit(files[0]);
      else if (files.length > 1) compress(files);
    });
  }, [edit, compress]);

  if (screen.name === 'editor') return <Editor onClose={home} />;
  if (screen.name === 'compress') return <Compress initialFiles={screen.files} onBack={home} />;
  if (screen.name === 'loading')
    return (
      <div className="screen loading">
        <div className="spinner" aria-label="Opening photo" />
      </div>
    );
  return <Home onEdit={edit} onCompress={compress} onSample={sample} error={error} />;
}

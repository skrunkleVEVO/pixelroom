import { useCallback, useEffect, useState } from 'react';
import { Collage } from './collage/Collage';
import { closeCollage, startCollage } from './collage/state';
import { Editor } from './editor/Editor';
import { closePhoto, openCanvas, openFile } from './editor/state';
import { createSampleScene } from './sample';
import { Compress } from './screens/Compress';
import { Home } from './screens/Home';
import { takeSharedFiles } from './shareTarget';

type Screen =
  | { name: 'home' }
  | { name: 'editor'; from: 'home' | 'collage' }
  | { name: 'collage' }
  | { name: 'compress'; files: File[] }
  | { name: 'loading' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [error, setError] = useState<string | null>(null);

  const edit = useCallback(async (file: File) => {
    setError(null);
    setScreen({ name: 'loading' });
    try {
      await openFile(file);
      setScreen({ name: 'editor', from: 'home' });
    } catch (e) {
      setError(e instanceof Error ? e.message : "This photo couldn't be opened.");
      setScreen({ name: 'home' });
    }
  }, []);

  const compress = useCallback((files: File[]) => {
    setError(null);
    setScreen({ name: 'compress', files });
  }, []);

  const makeCollage = useCallback(
    async (files: File[]) => {
      setError(null);
      if (files.length === 1) return edit(files[0]);
      setScreen({ name: 'loading' });
      try {
        await startCollage(files);
        setScreen({ name: 'collage' });
      } catch (e) {
        setError(e instanceof Error ? e.message : "These photos couldn't be opened.");
        setScreen({ name: 'home' });
      }
    },
    [edit],
  );

  const sample = useCallback(() => {
    openCanvas(createSampleScene(2400, 1600), 'sample');
    setScreen({ name: 'editor', from: 'home' });
  }, []);

  const home = useCallback(() => {
    closePhoto();
    closeCollage();
    setScreen({ name: 'home' });
  }, []);

  // Finish a collage in the editor (filters, text, save), keeping its shape.
  const finishCollage = useCallback((canvas: HTMLCanvasElement) => {
    openCanvas(canvas, 'collage', { format: 'original' });
    setScreen({ name: 'editor', from: 'collage' });
  }, []);

  const closeEditor = useCallback(() => {
    if (screen.name === 'editor' && screen.from === 'collage') {
      closePhoto();
      setScreen({ name: 'collage' });
    } else home();
  }, [screen, home]);

  // Photos shared into the installed app from the gallery (Android).
  useEffect(() => {
    takeSharedFiles().then((files) => {
      if (files.length === 1) void edit(files[0]);
      else if (files.length > 1) compress(files);
    });
  }, [edit, compress]);

  if (screen.name === 'editor') return <Editor onClose={closeEditor} />;
  if (screen.name === 'collage') return <Collage onBack={home} onNext={finishCollage} />;
  if (screen.name === 'compress') return <Compress initialFiles={screen.files} onBack={home} />;
  if (screen.name === 'loading')
    return (
      <div className="screen loading">
        <div className="spinner" aria-label="Opening photos" />
      </div>
    );
  return <Home onEdit={edit} onCompress={compress} onCollage={makeCollage} onSample={sample} error={error} />;
}

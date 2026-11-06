import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Fills in pwa/sw.js with every built file, and a version that changes when they do. */
function serviceWorker(): Plugin {
  return {
    name: 'pixelroom-service-worker',
    apply: 'build',
    closeBundle() {
      const dist = 'dist';
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const path = join(dir, name);
          return statSync(path).isDirectory() ? walk(path) : [path];
        });
      const files = walk(dist).filter((f) => !f.endsWith('sw.js'));
      const hash = createHash('sha256');
      for (const f of files) hash.update(readFileSync(f));
      const urls = files.map((f) => `./${relative(dist, f).replace(/\\/g, '/')}`);
      const source = readFileSync('pwa/sw.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__FILES__', JSON.stringify(urls));
      writeFileSync(join(dist, 'sw.js'), source);
    },
  };
}

export default defineConfig({
  // Relative base so `dist/` can be dropped onto any static host or sub-path.
  base: './',
  plugins: [react(), serviceWorker()],
  server: { host: true, port: 5173 },
});

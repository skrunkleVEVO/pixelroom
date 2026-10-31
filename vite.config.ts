import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so `dist/` can be dropped onto any static host or sub-path.
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
});

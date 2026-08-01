import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// The renderer lives in src/ui and is built into dist/ui, which the packaged
// main process loads with loadFile().
export default defineConfig({
  root: resolve(__dirname, 'src/ui'),
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'dist/ui'),
    emptyOutDir: true,
    target: 'chrome124',
    rollupOptions: {
      input: resolve(__dirname, 'src/ui/index.html'),
    },
  },
});

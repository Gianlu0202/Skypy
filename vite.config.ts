import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.SKYPY_API ?? 'http://localhost:3000';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': api,
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
  preview: { port: 4173 },
});

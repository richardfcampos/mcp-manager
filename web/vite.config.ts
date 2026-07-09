import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served as a static SPA by the Express server (src/server.ts) from
// web/dist, mounted at the app root. Base stays '/' so asset URLs resolve
// correctly regardless of which route the SPA is served under.
export default defineConfig({
  root: __dirname,
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

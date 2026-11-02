// Single-file build without service worker, used only for a browser preview.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'url';

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  define: { 'import.meta.env.VITE_NO_SW': JSON.stringify('1') },
  resolve: { alias: { 'virtual:pwa-register': fileURLToPath(new URL('./preview/pwa-stub.ts', import.meta.url)) } },
  build: { outDir: 'dist-preview', emptyOutDir: true },
});

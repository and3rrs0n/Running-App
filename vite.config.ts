import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base: './' makes the build work from any sub-path (GitHub Pages: /<repo>/, Cloudflare Pages: /).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered manually in src/main.tsx
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon-32.png'],
      manifest: {
        name: 'Løpeplan – personlig treningsapp',
        short_name: 'Løpeplan',
        description: 'Skadeforebyggende løpeplan, treningslogg og progresjon mot ultra.',
        lang: 'nb',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
} as any);

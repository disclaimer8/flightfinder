import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import compression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    // Pre-compress JS/CSS/HTML/SVG into *.br at build time so nginx can serve
    // them via brotli_static — single max-quality (level 11) compression done
    // once per release instead of dynamic level-5 per request. Drop dynamic
    // CPU + ~5-8% extra savings on assets that already dominate the wire.
    //
    // We don't pre-compress *.gz: brotli is supported by ~96% of clients and
    // nginx falls back to dynamic gzip (level 6) for the rest, which is
    // adequate for the long tail. Two compression() instances conflict via
    // shared plugin state — keep this simple.
    compression({ algorithm: 'brotliCompress', ext: '.br', threshold: 1024, deleteOriginFile: false }),
  ],
  build: {
    // Predictable chunk boundaries — react-vendor (react/react-dom/scheduler)
    // and router-vendor (react-router-dom) are split out so first-paint
    // doesn't wait for them. Leaflet lands in its own chunk because it's
    // imported dynamically inside the map components (also lazy-loaded via
    // React.lazy in App.jsx). Sentry is dynamic-imported in src/index.jsx
    // (after first paint via requestIdleCallback), so rolldown auto-creates
    // an async chunk for it and its @sentry/* deps without an explicit rule.
    //
    // The path matchers below use `node_modules/<pkg>/` (with both the
    // leading and trailing slash) — without that anchoring `react-vendor`
    // greedily caught `@sentry/react` because its path also contains
    // `/react/`. The bug ballooned react-vendor from 189KB to 650KB raw
    // when sentry was made async; tight matchers prevent recurrence.
    rollupOptions: {
      output: {
        entryFileNames:  'assets/[name]-[hash:16].js',
        chunkFileNames:  'assets/[name]-[hash:16].js',
        assetFileNames:  'assets/[name]-[hash:16][extname]',
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) return 'react-vendor';
          if (id.includes('node_modules/react-router/') || id.includes('node_modules/react-router-dom/')) {
            return 'router-vendor';
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
});

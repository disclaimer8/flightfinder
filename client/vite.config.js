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
    // Predictable chunk boundaries — react-vendor (react/react-dom/scheduler),
    // router-vendor (react-router-dom), and sentry are split out so that
    // first-paint doesn't wait for them. Leaflet already lands in its own
    // chunk because it's imported dynamically inside the map components
    // (also lazy-loaded via React.lazy in App.jsx). Each chunk hash is stable
    // across releases as long as the underlying library version doesn't
    // change, which keeps long-term browser cache hits high.
    rollupOptions: {
      output: {
        entryFileNames:  'assets/[name]-[hash:16].js',
        chunkFileNames:  'assets/[name]-[hash:16].js',
        assetFileNames:  'assets/[name]-[hash:16][extname]',
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
              return 'react-vendor';
            }
            if (id.includes('react-router')) return 'router-vendor';
            if (id.includes('@sentry')) return 'sentry';
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

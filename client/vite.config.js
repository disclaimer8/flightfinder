import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Predictable chunk boundaries — react-vendor and sentry are split out
    // so that first-paint doesn't wait for them. Leaflet already lands in
    // its own chunk because it's imported dynamically inside the map
    // components (also lazy-loaded via React.lazy in App.jsx).
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

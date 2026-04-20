import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames:  'assets/[name]-[hash:16].js',
        chunkFileNames:  'assets/[name]-[hash:16].js',
        assetFileNames:  'assets/[name]-[hash:16][extname]',
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

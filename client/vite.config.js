import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import compression from 'vite-plugin-compression';

/**
 * Inline the entry CSS into <head> so first paint doesn't block on a
 * separate /assets/index-*.css fetch. Lazy-route CSS chunks
 * (AircraftLandingPage.css, RouteMap.css etc.) are still emitted as
 * separate <link rel="stylesheet"> tags by Vite — only the entry
 * chunk's CSS gets inlined here.
 *
 * Why a custom plugin: the obvious "use beasties / critters" path tries
 * to extract _critical_ CSS via puppeteer above-the-fold detection,
 * which is fragile and adds 30+ MB of node_modules. Our entry CSS is
 * already tiny (~46 KB raw / 8 KB brotli). Just inline the whole thing.
 *
 * CSP-compatible: the result is an inline `<style>` block, allowed by
 * the existing `style-src 'self' 'unsafe-inline'` directive in helmet.
 */
// Escape every RegExp metacharacter, not just `.`. Vite's content-hash
// fileNames are alphanumeric in practice, so escaping only the dot
// happened to work — but a pattern that escapes `.` and silently passes
// through `\`, `^`, `$`, `*`, `+`, `?`, `(`, `)`, `[`, `]`, `{`, `}`, `|`
// is exactly the shape CodeQL flags as "incomplete string escaping".
// One day someone changes assetFileNames to include a literal bracket
// or plus-sign and the regex starts matching the wrong link tag, or
// throws on construction. Use the standard MDN escape pattern. (We can
// switch to RegExp.escape() once Node ≥24 is the floor; today we want
// the same code to run in test on whatever the dev's Node is.)
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inlineEntryCss() {
  return {
    name: 'inline-entry-css',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        const entryCssAsset = Object.values(ctx.bundle).find(
          (a) => a.type === 'asset' && a.fileName?.startsWith('assets/index-') && a.fileName.endsWith('.css')
        );
        if (!entryCssAsset || typeof entryCssAsset.source !== 'string') return html;
        const cssContent = entryCssAsset.source;
        const linkRe = new RegExp(`<link[^>]+href="/${escapeRegExp(entryCssAsset.fileName)}"[^>]*>`, 'i');
        const inlined = `<style data-inline-entry-css>${cssContent}</style>`;
        return html.replace(linkRe, inlined);
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    inlineEntryCss(),
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
    // React.lazy in App.jsx).
    //
    // The path matchers below use `node_modules/<pkg>/` (with both the
    // leading and trailing slash). We previously had `@sentry/react` here;
    // the unanchored substring `/react/` greedily caught the Sentry SDK
    // and ballooned react-vendor 189→650KB. The SDK has since been removed
    // (replaced by src/errorReporter.js, no node_modules dep), but keep
    // the anchored matchers as a defensive pattern for future deps.
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

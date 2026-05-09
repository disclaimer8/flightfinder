// server/src/services/seoContentCache.js
const seoMeta = require('./seoMetaService');
const builders = require('./seoContentBuilders');
const { enumerateSeoUrls } = require('./seoUrlEnumerator');

const REFRESH_MS = 6 * 60 * 60 * 1000; // 6h

const map = new Map();
let lastWarmedAt = 0;
let timer = null;

function warm(opts = {}) {
  const schedule = opts.schedule !== false;
  let paths;
  try {
    paths = enumerateSeoUrls();
  } catch (err) {
    // Fall back to static-only — sentry capture is fire-and-forget.
    try { require('@sentry/node').captureException(err); } catch {}
    const { STATIC_PATHS } = require('./seoUrlEnumerator');
    paths = STATIC_PATHS;
  }

  // Track every path we attempted this pass — used by refresh() to distinguish
  // "URL no longer enumerated" (prune) from "builder failed but URL still
  // exists" (preserve prior value).
  const attempted = new Set();

  for (const p of paths) {
    attempted.add(p);
    let meta;
    try { meta = seoMeta.resolve(p); } catch { continue; }
    if (!meta) continue;
    const canonical = meta.canonical || `https://himaxym.com${p}`;
    attempted.add(canonical);

    let html;
    try { html = builders.build(meta); } catch (err) {
      try { require('@sentry/node').captureException(err, { tags: { seo_path: p } }); } catch {}
      continue;
    }
    if (html != null) {
      map.set(canonical, html);
      map.set(p, html);
    }
  }

  lastWarmedAt = Date.now();

  if (schedule && timer == null) {
    timer = setInterval(refresh, REFRESH_MS);
    if (timer.unref) timer.unref(); // don't keep the event loop alive in tests
  }

  return attempted;
}

function refresh() {
  // Re-warm; preserve prior values for URLs whose builders failed this pass
  // (they remain in the enumerated set so we don't prune them). Only delete
  // keys that have genuinely fallen out of the enumeration.
  const attempted = warm({ schedule: false });
  for (const key of [...map.keys()]) {
    if (!attempted.has(key)) map.delete(key);
  }
}

function get(pathname) {
  if (!pathname) return null;
  return map.get(pathname) || null;
}

function stats() {
  return { size: map.size, lastWarmedAt };
}

function _clearForTests() {
  map.clear();
  if (timer) { clearInterval(timer); timer = null; }
  lastWarmedAt = 0;
}

function _injectForTests(key, html) {
  map.set(key, html);
}

module.exports = { warm, refresh, get, stats, _clearForTests, _injectForTests };

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

  for (const p of paths) {
    let meta;
    try { meta = seoMeta.resolve(p); } catch { continue; }
    if (!meta) continue;
    let html;
    try { html = builders.build(meta); } catch (err) {
      try { require('@sentry/node').captureException(err, { tags: { seo_path: p } }); } catch {}
      continue;
    }
    if (html != null) map.set(meta.canonical || `https://himaxym.com${p}`, html);
    // Also key by request-path (without origin) so spaFallback can do a direct lookup.
    if (html != null) map.set(p, html);
  }

  lastWarmedAt = Date.now();

  if (schedule && timer == null) {
    timer = setInterval(refresh, REFRESH_MS);
    if (timer.unref) timer.unref(); // don't keep the event loop alive in tests
  }
}

function refresh() {
  // Re-warm without scheduling another timer. Failures in any one builder
  // already short-circuit inside warm(); a refresh that produces no value
  // for a key leaves the prior value in place because we only set, never
  // delete. To prune stale entries on URL removal, snapshot the keyset
  // before warm() and delete the diff afterwards.
  const before = new Set(map.keys());
  warm({ schedule: false });
  const after = new Set(map.keys());
  for (const key of before) if (!after.has(key)) map.delete(key);
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

module.exports = { warm, refresh, get, stats, _clearForTests };

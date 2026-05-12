// server/src/services/seoContentCache.js
const seoMeta = require('./seoMetaService');
const builders = require('./seoContentBuilders');
const { enumerateSeoUrls } = require('./seoUrlEnumerator');
const fr24CacheService = require('./fr24CacheService');

// Sentry is optional in test envs; load once at module init.
let Sentry;
try { Sentry = require('@sentry/node'); } catch { /* optional dep */ }

const REFRESH_MS = 6 * 60 * 60 * 1000; // 6h

const map = new Map();
let lastWarmedAt = 0;
let timer = null;

/**
 * Populate (or repopulate) the cache from enumerateSeoUrls(). This is
 * additive — it sets entries but does NOT prune keys for URLs that have
 * fallen out of the enumeration. Pruning happens only via refresh(),
 * which consumes the returned `attempted` set.
 *
 * For initial boot warming, calling warm() directly is correct because
 * the cache starts empty. For periodic refresh, call refresh() — it
 * handles both repopulation and pruning.
 *
 * @param {{schedule?: boolean}} [opts]
 * @returns {Set<string>} the set of paths attempted this pass; refresh()
 *   uses this to determine what to prune
 */
async function warm(opts = {}) {
  const schedule = opts.schedule !== false;
  let paths;
  try {
    paths = enumerateSeoUrls();
  } catch (err) {
    // Fall back to static-only — sentry capture is fire-and-forget.
    try { Sentry?.captureException(err); } catch {}
    const { STATIC_PATHS } = require('./seoUrlEnumerator');
    paths = STATIC_PATHS;
  }

  // Fire-and-forget FR24 refresh. Runs in background (~94 min throttled);
  // current warm bakes whatever is already in the FR24 cache. Next warm
  // (≤6h later) picks up newly populated entries.
  if (fr24CacheService.isStale()) {
    fr24CacheService.refresh().catch((err) => {
      console.warn(`[fr24] background refresh error: ${err.message || err}`);
    });
  }

  // Fire-and-forget Amadeus analytics refresh — leader-only, daily-budget-capped.
  // Same pattern as FR24: this warm bakes whatever is already cached; the next
  // warm picks up newly fetched rows.
  if (!process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0') {
    try {
      require('./amadeusAnalyticsService').refreshStale().catch((err) => {
        console.warn(`[amadeus-analytics] background refresh error: ${err.message || err}`);
      });
    } catch (err) {
      console.warn(`[amadeus-analytics] failed to schedule refresh: ${err.message || err}`);
    }
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
    try {
      // buildAsync handles airport/airline/route via awaited Amadeus reads;
      // all other kinds delegate to the sync build() unchanged.
      html = await builders.buildAsync(meta);
    } catch (err) {
      try { Sentry?.captureException(err, { tags: { seo_path: p } }); } catch {}
      continue;
    }
    if (html != null) {
      map.set(canonical, html);
      map.set(p, html);
    }
  }

  lastWarmedAt = Date.now();

  if (schedule && timer == null) {
    timer = setInterval(() => {
      refresh().catch((err) => console.warn(`[seo-cache] scheduled refresh error: ${err.message || err}`));
    }, REFRESH_MS);
    if (timer.unref) timer.unref(); // don't keep the event loop alive in tests
  }

  return attempted;
}

/**
 * Re-warm the cache and prune keys for URLs no longer enumerated.
 * Builder failures during this pass do NOT cause pruning — the
 * pre-existing cached value is preserved (URL still in the attempted
 * set even when its build threw). Only URLs absent from the
 * enumeration are removed.
 */
async function refresh() {
  // Re-warm; preserve prior values for URLs whose builders failed this pass
  // (they remain in the enumerated set so we don't prune them). Only delete
  // keys that have genuinely fallen out of the enumeration.
  const attempted = await warm({ schedule: false });
  for (const key of [...map.keys()]) {
    if (!attempted.has(key)) map.delete(key);
  }
}

function get(pathname) {
  if (!pathname) return null;
  return map.get(pathname) || null;
}

// Lazy-bake cache for /accidents/{slug} pages — deliberately NOT pre-warmed
// (22K entries × ~5ms each blocks the event loop long enough that PM2
// wait_ready times out on deploy). First bot hit triggers buildAsync; result
// is cached in an LRU+TTL map. Subsequent hits are served instantly.
const LAZY_MAX = 5000;
const LAZY_TTL_MS = 24 * 3600 * 1000;
const lazyMap = new Map();

async function getOrBuild(pathname) {
  if (!pathname) return null;
  // Fast path: the pre-warmed map covers airport / airline / aircraft / route.
  const fromMap = map.get(pathname);
  if (fromMap) return fromMap;
  // Lazy path covers two unbounded URL families that we don't pre-warm:
  //   /accidents/{slug}      — ~22K rows; warming blocks pm2 wait_ready
  //   /safety/events/{id}    — ~500 indexable rows but the id-numeric form
  //                            also legitimately hits via legacy links and
  //                            the slug form is enumerated separately
  const isLazyPath =
    /^\/accidents\/[^/]+\/?$/.test(pathname) ||
    /^\/safety\/events\/[^/]+\/?$/.test(pathname);
  if (!isLazyPath) return null;

  const now = Date.now();
  const cached = lazyMap.get(pathname);
  if (cached && cached.expiresAt > now) {
    cached.lastAccess = now;
    return cached.html;
  }

  let meta;
  try { meta = seoMeta.resolve(pathname); } catch { return null; }
  if (!meta || (meta.kind !== 'accident' && meta.kind !== 'safety-event')) return null;

  let html;
  try { html = await builders.buildAsync(meta); } catch { return null; }
  if (html == null) return null;

  lazyMap.set(pathname, { html, expiresAt: now + LAZY_TTL_MS, lastAccess: now });
  // Cheap O(n) LRU eviction (n ≤ LAZY_MAX). With 5000 entries this is ~50µs
  // amortized over insertions, much simpler than wiring up an actual LRU lib.
  if (lazyMap.size > LAZY_MAX) {
    let oldestKey = null;
    let oldestAccess = Infinity;
    for (const [k, v] of lazyMap) {
      if (v.lastAccess < oldestAccess) { oldestAccess = v.lastAccess; oldestKey = k; }
    }
    if (oldestKey) lazyMap.delete(oldestKey);
  }
  return html;
}

function stats() {
  return {
    // map.size counts both canonical-URL and pathname keys per page (~2× page count).
    size: map.size,
    pageCount: Math.round(map.size / 2),
    lazySize: lazyMap.size,
    lastWarmedAt,
  };
}

function _clearForTests() {
  map.clear();
  lazyMap.clear();
  if (timer) { clearInterval(timer); timer = null; }
  lastWarmedAt = 0;
}

function _injectForTests(key, html) {
  map.set(key, html);
}

module.exports = { warm, refresh, get, getOrBuild, stats, _clearForTests, _injectForTests };

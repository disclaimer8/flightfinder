// server/src/services/fr24CacheService.js
//
// In-memory sidecar cache for FR24 derived facts. Holds DerivedStats keyed by
// `variant:${icao}`, `family:${slug}`, and `route:${from}-${to}` with a 7-day
// TTL. Populated by refresh() which is invoked from seoContentCache.warm().
//
// No persistence — process restart loses the cache. Acceptable per the
// 6-hour cold-start window in the design spec.

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_FLOOR_MS = TTL_MS / 2;  // skip if entry was refreshed in the last 3.5 days

const _store = new Map();

function get(key) {
  return _store.get(key) || null;
}

function set(key, value) {
  _store.set(key, value);
}

function clear() {
  _store.clear();
}

function stats() {
  let oldest = null, newest = null;
  for (const v of _store.values()) {
    if (oldest === null || v.fetchedAt < oldest) oldest = v.fetchedAt;
    if (newest === null || v.fetchedAt > newest) newest = v.fetchedAt;
  }
  return { keys: _store.size, oldestFetchedAt: oldest, newestFetchedAt: newest };
}

function isStale() {
  if (_store.size === 0) return true;
  const { oldestFetchedAt } = stats();
  return Date.now() - oldestFetchedAt > TTL_MS;
}

function _isFresh(key) {
  const entry = _store.get(key);
  return entry && (Date.now() - entry.fetchedAt) < REFRESH_FLOOR_MS;
}

async function refresh() {
  const fr24 = require('./fr24Service');
  if (!fr24.isEnabled()) {
    return { refreshed: 0, skipped: 0, failed: 0 };
  }

  const { getAllVariants } = require('../models/aircraftVariants');
  const { getFamilyList, getFamilyBySlug } = require('../models/aircraftFamilies');
  const db = require('../models/db');

  let refreshed = 0, skipped = 0, failed = 0;

  for (const v of getAllVariants()) {
    const key = `variant:${v.icao}`;
    if (_isFresh(key)) { skipped++; continue; }
    const stats = await fr24.fetchVariantStats(v.icao);
    if (stats) { _store.set(key, stats); refreshed++; }
    else { failed++; }
  }

  for (const fam of getFamilyList()) {
    const key = `family:${fam.slug}`;
    if (_isFresh(key)) { skipped++; continue; }
    const fullFam = getFamilyBySlug(fam.slug);
    const icaoList = (fullFam && fullFam.icaoList) || [];
    const stats = await fr24.fetchFamilyStats(icaoList);
    if (stats) { _store.set(key, stats); refreshed++; }
    else { failed++; }
  }

  for (const route of db.getTopRoutesByObservedFrequency(200)) {
    // Canonicalize to dedupe directions: JFK-LHR and LHR-JFK collapse to one key.
    // Resolver in seoMetaService applies the same canonicalization on read.
    const [from, to] = [route.from, route.to].map((s) => String(s || '').toUpperCase()).sort();
    const key = `route:${from}-${to}`;
    if (_isFresh(key)) { skipped++; continue; }
    // Use ORIGINAL (non-canonicalized) from/to for the FR24 query — the API may treat
    // direction as significant. Cache key dedup only happens locally.
    const stats = await fr24.fetchRouteStats(route.from, route.to);
    if (stats) { _store.set(key, stats); refreshed++; }
    else { failed++; }
  }

  console.log(`[fr24] refresh: ${refreshed} refreshed, ${skipped} skipped, ${failed} failed`);
  return { refreshed, skipped, failed };
}

module.exports = { get, set, clear, isStale, stats, refresh, _internal: { TTL_MS, REFRESH_FLOOR_MS } };

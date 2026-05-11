// server/src/services/fr24CacheService.js
//
// SQLite-backed sidecar cache for FR24 derived facts. Stores DerivedStats keyed
// by `variant:${icao}`, `family:${slug}`, and `route:${from}-${to}` (alphabetically
// canonicalized) with a 7-day TTL.
//
// History: originally RAM-only. Migrated to SQLite (2026-05-11) after we caught
// that pm2 reload was wiping the in-memory cache between deploys, so the first
// warm() after every deploy baked pages WITHOUT FR24 blocks — the cache only
// repopulated 30+ min later, but seoContentCache.map already held empty bakes
// until the next 6h scheduled refresh. SQLite persistence breaks that cycle.
//
// Cluster mode invariant: refresh() only originates fetches on the leader worker
// (NODE_APP_INSTANCE === '0'). Followers read from SQLite, which is shared
// across workers via WAL mode. This halves FR24 credit burn vs the prior
// per-worker behavior.

const { db } = require('../models/db');

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_FLOOR_MS = TTL_MS / 2;  // skip if entry was refreshed in the last 3.5 days

const stmts = {
  get:    db.prepare('SELECT payload_json, fetched_at, expires_at FROM fr24_cache WHERE cache_key = ?'),
  upsert: db.prepare(`INSERT INTO fr24_cache(cache_key, payload_json, fetched_at, expires_at)
                      VALUES (?, ?, ?, ?)
                      ON CONFLICT(cache_key) DO UPDATE SET
                        payload_json = excluded.payload_json,
                        fetched_at   = excluded.fetched_at,
                        expires_at   = excluded.expires_at`),
  clear:  db.prepare('DELETE FROM fr24_cache'),
  stats:  db.prepare(`SELECT COUNT(*) AS n,
                             MIN(fetched_at) AS oldest,
                             MAX(fetched_at) AS newest
                      FROM fr24_cache`),
};

function isLeader() {
  return !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
}

function get(key) {
  const row = stmts.get.get(key);
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    // Preserve fetchedAt-on-the-payload contract for existing readers.
    if (payload.fetchedAt == null) payload.fetchedAt = row.fetched_at;
    return payload;
  } catch {
    return null;
  }
}

function set(key, value) {
  const now = Date.now();
  const fetchedAt = value?.fetchedAt || now;
  stmts.upsert.run(key, JSON.stringify(value), fetchedAt, fetchedAt + TTL_MS);
}

function clear() {
  stmts.clear.run();
}

function stats() {
  const row = stmts.stats.get();
  return {
    keys: row.n,
    oldestFetchedAt: row.oldest,
    newestFetchedAt: row.newest,
  };
}

function isStale() {
  const { keys, oldestFetchedAt } = stats();
  if (keys === 0) return true;
  return Date.now() - oldestFetchedAt > TTL_MS;
}

function _isFresh(key) {
  const row = stmts.get.get(key);
  if (!row) return false;
  return (Date.now() - row.fetched_at) < REFRESH_FLOOR_MS;
}

async function refresh() {
  // Leader-only: followers serve from SQLite without firing fetches.
  if (!isLeader()) {
    return { refreshed: 0, skipped: 0, failed: 0, reason: 'follower' };
  }

  const fr24 = require('./fr24Service');
  if (!fr24.isEnabled()) {
    return { refreshed: 0, skipped: 0, failed: 0, reason: 'disabled' };
  }

  const { getAllVariants } = require('../models/aircraftVariants');
  const { getFamilyList, getFamilyBySlug } = require('../models/aircraftFamilies');
  const dbMod = require('../models/db');

  let refreshed = 0, skipped = 0, failed = 0;

  for (const v of getAllVariants()) {
    const key = `variant:${v.icao}`;
    if (_isFresh(key)) { skipped++; continue; }
    const stats = await fr24.fetchVariantStats(v.icao);
    if (stats) { set(key, stats); refreshed++; }
    else { failed++; }
  }

  for (const fam of getFamilyList()) {
    const key = `family:${fam.slug}`;
    if (_isFresh(key)) { skipped++; continue; }
    const fullFam = getFamilyBySlug(fam.slug);
    const icaoList = (fullFam && fullFam.icaoList) || [];
    const stats = await fr24.fetchFamilyStats(icaoList);
    if (stats) { set(key, stats); refreshed++; }
    else { failed++; }
  }

  for (const route of dbMod.getTopRoutesByObservedFrequency(200)) {
    // Canonicalize to dedupe directions: JFK-LHR and LHR-JFK collapse to one key.
    // Resolver in seoMetaService applies the same canonicalization on read.
    const [from, to] = [route.from, route.to].map((s) => String(s || '').toUpperCase()).sort();
    const key = `route:${from}-${to}`;
    if (_isFresh(key)) { skipped++; continue; }
    // Use ORIGINAL (non-canonicalized) from/to for the FR24 query — the API may treat
    // direction as significant. Cache key dedup only happens locally.
    const stats = await fr24.fetchRouteStats(route.from, route.to);
    if (stats) { set(key, stats); refreshed++; }
    else { failed++; }
  }

  console.log(`[fr24] refresh: ${refreshed} refreshed, ${skipped} skipped, ${failed} failed`);
  return { refreshed, skipped, failed };
}

module.exports = { get, set, clear, isStale, stats, refresh, _internal: { TTL_MS, REFRESH_FLOOR_MS } };

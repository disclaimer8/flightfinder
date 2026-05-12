'use strict';

/**
 * FR24 → GF Route Aircraft Ingest.
 *
 * For every distinct (origin, destination) pair in AirCrash's gf.flights,
 * calls fr24Service.fetchRouteAircraftBuckets — which queries FR24 and
 * derives per-(aircraft, airline) buckets inside the service (TOS-safe;
 * raw lightRows never leave the service) — then upserts the buckets into
 * fr24_gf_route_aircraft. TTL-gated (7d) and rate-limited (10 q/min).
 * Lock-file prevents overlapping runs.
 *
 * Spec: docs/superpowers/specs/2026-05-12-fr24-gf-route-ingest-design.md
 */

const fs = require('node:fs');
const path = require('node:path');

// Load server/.env so FR24_API_KEY (and friends) are available when invoked
// directly via cron or SSH, not just under pm2 where they're already set.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_TTL_MS  = 7 * 24 * 3600 * 1000;
const DEFAULT_RATE_MS = 6000;
const DEFAULT_LOCK    = '/tmp/fr24-gf-ingest.lock';
const DEFAULT_ACCIDENTS_DB =
  process.env.ACCIDENTS_DB_PATH || '/root/flightfinder/data/accidents.db';

function acquireLockOrExit(lockPath) {
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pidStr = fs.readFileSync(lockPath, 'utf8').trim();
    const pid = parseInt(pidStr, 10);
    if (Number.isFinite(pid) && pid > 0) {
      let alive = false;
      try {
        process.kill(pid, 0);  // signal 0 = existence check; throws if dead
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) {
        console.error(`[fr24GfIngest] previous run still active (pid ${pid}), exiting`);
        process.exit(0);
        return; // unreachable in prod; in tests where exit is mocked to throw, this never executes
      }
      // PID dead → stale lock; remove and recurse
      fs.unlinkSync(lockPath);
      return acquireLockOrExit(lockPath);
    }
    // Unparseable contents — treat as stale
    fs.unlinkSync(lockPath);
    return acquireLockOrExit(lockPath);
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch {}
}

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Pure orchestrator. Accepts an explicit pair list (injected by main() in prod
 * via ATTACH; injected directly in tests). Does NOT manage lock or argv.
 */
async function runIngest({ pairs, ttlMs = DEFAULT_TTL_MS, rateMs = DEFAULT_RATE_MS } = {}) {
  const fr24Service = require('../src/services/fr24Service');
  const dbModule = require('../src/models/db');

  const startedAt = Date.now();
  const meta = {
    started_at: startedAt,
    pairs_total: pairs.length,
    pairs_queried: 0,
    pairs_skipped: 0,
    pairs_empty: 0,
    pairs_failed: 0,
    rows_upserted: 0,
  };

  if (!fr24Service.isEnabled()) {
    meta.error_summary = 'FR24 disabled (no FR24_API_KEY)';
    meta.finished_at = Date.now();
    meta.credits_used = 0;
    dbModule.writeFr24GfIngestMeta(meta);
    console.error('[fr24GfIngest] FR24 disabled — exiting without queries');
    return meta;
  }

  const cutoff = Date.now() - ttlMs;

  for (const { dep, arr } of pairs) {
    if (dbModule.fr24GfRouteFreshExists(dep, arr, cutoff)) {
      meta.pairs_skipped++;
      console.log(`[fr24GfIngest] ${dep}->${arr}: skipped (fresh)`);
      continue;  // no FR24 call → no rate-limit sleep needed
    }

    let buckets;
    try {
      buckets = await fr24Service.fetchRouteAircraftBuckets(dep, arr);
    } catch (err) {
      meta.pairs_failed++;
      console.error(`[fr24GfIngest] ${dep}->${arr}: ERROR ${err.message}`);
      if (rateMs > 0) await sleep(rateMs);  // back off after errors (429 etc.)
      continue;
    }
    // null = fetch failed (logged inside the service); count as failure.
    // [] = fetched OK but no buckets (empty result for this route).
    if (buckets === null) {
      meta.pairs_failed++;
      console.error(`[fr24GfIngest] ${dep}->${arr}: ERROR (null return)`);
      if (rateMs > 0) await sleep(rateMs);
      continue;
    }
    meta.pairs_queried++;

    if (buckets.length === 0) {
      meta.pairs_empty++;
      console.log(`[fr24GfIngest] ${dep}->${arr}: FR24 empty (queried but no buckets)`);
    } else {
      const now = Date.now();
      const rows = buckets.map(b => ({
        ...b,
        dep_iata: dep,
        arr_iata: arr,
        first_seen_at: now,
        last_seen_at:  now,
      }));
      const n = dbModule.upsertFr24GfRoutes(rows);
      meta.rows_upserted += n;
      console.log(`[fr24GfIngest] ${dep}->${arr}: queried, ${rows.length} buckets upserted`);
    }

    if (rateMs > 0) await sleep(rateMs);  // pace after every FR24 call (success or empty)
  }

  // Failure-rate sentinel — only flag when we actually attempted ≥3 queries.
  if (meta.pairs_queried + meta.pairs_failed >= 3 &&
      meta.pairs_failed / Math.max(1, meta.pairs_queried + meta.pairs_failed) > 0.3) {
    meta.error_summary = `high failure rate: ${meta.pairs_failed}/${meta.pairs_queried + meta.pairs_failed}`;
  }

  meta.credits_used = meta.pairs_queried;
  meta.finished_at = Date.now();
  dbModule.writeFr24GfIngestMeta(meta);
  return meta;
}

/**
 * Load pair list from gf.flights via ATTACH. Returns [] (and logs) if file missing.
 */
function loadPairsFromAccidentsDb(accidentsDbPath) {
  const dbModule = require('../src/models/db');
  if (!fs.existsSync(accidentsDbPath)) {
    console.error(`[fr24GfIngest] accidents.db not found at ${accidentsDbPath}`);
    return [];
  }
  dbModule.db.exec(`ATTACH DATABASE '${accidentsDbPath.replace(/'/g, "''")}' AS gf_attached`);
  try {
    return dbModule.db.prepare(`
      SELECT DISTINCT origin AS dep, destination AS arr
      FROM gf_attached.flights
      WHERE origin IS NOT NULL AND destination IS NOT NULL
      ORDER BY origin, destination
    `).all();
  } finally {
    try { dbModule.db.exec('DETACH DATABASE gf_attached'); } catch {}
  }
}

function computeCoverage(gfPairs) {
  const dbModule = require('../src/models/db');
  const gf_pairs = gfPairs.length;
  if (gf_pairs === 0) return { gf_pairs: 0, covered_pairs: 0, pct: 0 };
  let covered_pairs = 0;
  const stmt = dbModule.db.prepare(`
    SELECT 1 FROM fr24_gf_route_aircraft
    WHERE dep_iata = ? AND arr_iata = ? LIMIT 1
  `);
  for (const { dep, arr } of gfPairs) {
    if (stmt.get(dep, arr)) covered_pairs++;
  }
  const pct = Math.round((1000 * covered_pairs) / gf_pairs) / 10;
  return { gf_pairs, covered_pairs, pct };
}

/**
 * CLI entrypoint. Args:
 *   --dump-first-row <DEP> <ARR>  → print the aircraft/airline bucket array for one
 *                                    pair (operator-friendly: shows what FR24 sees
 *                                    on that route) and exit, no DB writes. Raw
 *                                    lightRows are not exposed by fr24Service per
 *                                    TOS isolation, so we surface buckets instead.
 *   --limit <N>                   → process only first N pairs
 *   (no args)                     → full ingest
 */
async function main(argv = process.argv.slice(2)) {
  if (argv[0] === '--dump-first-row') {
    const dep = argv[1], arr = argv[2];
    if (!dep || !arr) {
      console.error('Usage: --dump-first-row <DEP> <ARR>');
      process.exit(2);
    }
    const fr24Service = require('../src/services/fr24Service');
    const buckets = await fr24Service.fetchRouteAircraftBuckets(dep, arr);
    console.log(JSON.stringify(buckets, null, 2));
    return;
  }

  acquireLockOrExit(DEFAULT_LOCK);
  try {
    let pairs = loadPairsFromAccidentsDb(DEFAULT_ACCIDENTS_DB);
    const limitIdx = argv.indexOf('--limit');
    if (limitIdx !== -1) {
      const n = parseInt(argv[limitIdx + 1], 10);
      if (Number.isFinite(n) && n > 0) pairs = pairs.slice(0, n);
    }
    console.log(`[fr24GfIngest] START pairs_total=${pairs.length}`);
    const result = await runIngest({ pairs });
    const duration = ((result.finished_at - result.started_at) / 1000).toFixed(0);
    console.log(`[fr24GfIngest] DONE queried=${result.pairs_queried} skipped=${result.pairs_skipped} empty=${result.pairs_empty} failed=${result.pairs_failed} upserted=${result.rows_upserted} duration=${duration}s`);
    const cov = computeCoverage(pairs);
    console.log(`[fr24GfIngest] coverage: ${cov.covered_pairs}/${cov.gf_pairs} pairs (${cov.pct}%)`);
    if (result.error_summary) console.error(`[fr24GfIngest] WARN ${result.error_summary}`);
  } finally {
    releaseLock(DEFAULT_LOCK);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[fr24GfIngest] FATAL', err);
    releaseLock(DEFAULT_LOCK);
    process.exit(1);
  });
}

module.exports = {
  acquireLockOrExit,
  releaseLock,
  runIngest,
  loadPairsFromAccidentsDb,
  computeCoverage,
};

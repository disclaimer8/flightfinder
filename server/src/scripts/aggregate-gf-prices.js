'use strict';
/**
 * aggregate-gf-prices.js — daily join of gf.flights (price) with
 * fr24_gf_route_aircraft (aircraft buckets) into route_aircraft_prices.
 *
 * Spec: docs/superpowers/specs/2026-05-19-route-aircraft-prices-data-design.md
 *
 * CLI:
 *   node server/src/scripts/aggregate-gf-prices.js           — write to app.db
 *   node server/src/scripts/aggregate-gf-prices.js --dry-run — read+log, no UPSERT
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { parsePriceEur, firstMarketingCarrier } = require('../services/gfPriceParsing');
const openFlightsService = require('../services/openFlightsService');

const DEFAULT_APP_DB       = process.env.APP_DB_PATH || '/var/lib/flightfinder/data/app.db';
const DEFAULT_ACCIDENTS_DB = process.env.ACCIDENTS_DB_PATH || '/var/lib/flightfinder/data/accidents.db';
const DEFAULT_LOCK         = '/tmp/aggregate-gf-prices.lock';
const STALE_BUCKET_MS      = 30 * 24 * 3600 * 1000;
const MIN_QUOTES           = 3;

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return null;
  if (n % 2) return a[(n - 1) / 2];
  return (a[n / 2 - 1] + a[n / 2]) / 2;
}

/**
 * Pure aggregate function — exported for tests. Operates on two open DB
 * handles. Returns counters. Does NOT manage lock or meta lifecycle.
 */
function aggregate({ appDb, accDb, dryRun = false, now = Date.now() }) {
  const counters = {
    pairsProcessed: 0, bucketsIn: 0, bucketsOut: 0,
    quotesTotal: 0, skippedThin: 0, skippedNoMatch: 0,
  };

  const pairs = appDb.prepare(`
    SELECT DISTINCT dep_iata, arr_iata FROM fr24_gf_route_aircraft
    WHERE last_seen_at > ?
  `).all(now - STALE_BUCKET_MS);

  const isKnownAirlineName = (name) =>
    openFlightsService.getAirlineByName(name) !== null;

  const upsert = appDb.prepare(`
    INSERT INTO route_aircraft_prices
      (dep_iata, arr_iata, aircraft_icao, median_eur, min_eur, max_eur,
       n_quotes, airlines_csv, snapshot_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dep_iata, arr_iata, aircraft_icao) DO UPDATE SET
      median_eur=excluded.median_eur, min_eur=excluded.min_eur,
      max_eur=excluded.max_eur, n_quotes=excluded.n_quotes,
      airlines_csv=excluded.airlines_csv, snapshot_at=excluded.snapshot_at
  `);

  const tx = appDb.transaction(() => {
    for (const { dep_iata, arr_iata } of pairs) {
      counters.pairsProcessed++;

      const quotes = accDb.prepare(`
        SELECT id, price, airline FROM flights
        WHERE origin = ? AND destination = ?
          AND (stops IS NULL OR stops = '' OR stops = 'Nonstop')
      `).all(dep_iata, arr_iata);

      const buckets = appDb.prepare(`
        SELECT aircraft_icao, airline_icao, sample_size
        FROM fr24_gf_route_aircraft
        WHERE dep_iata = ? AND arr_iata = ?
      `).all(dep_iata, arr_iata);

      counters.bucketsIn += buckets.length;

      // Build per-airline quote lists. Map: airlineIcao → [{id, eur}]
      const quotesByAirline = new Map();
      for (const q of quotes) {
        const eur = parsePriceEur(q.price);
        if (eur === null) continue;
        const carrier = firstMarketingCarrier(q.airline, isKnownAirlineName);
        if (!carrier) { counters.skippedNoMatch++; continue; }
        const rec = openFlightsService.getAirlineByName(carrier);
        if (!rec || !rec.icao) { counters.skippedNoMatch++; continue; }
        const icao = String(rec.icao).toUpperCase();
        if (!quotesByAirline.has(icao)) quotesByAirline.set(icao, []);
        quotesByAirline.get(icao).push({ id: q.id, eur });
      }
      counters.quotesTotal += Array.from(quotesByAirline.values())
        .reduce((s, list) => s + list.length, 0);

      // For each aircraft on this pair, collect quotes from operating airlines.
      const byAircraft = new Map(); // icao → { quotes: [], airlines: Set }
      for (const b of buckets) {
        const acIcao = b.aircraft_icao.toUpperCase();
        const alIcao = (b.airline_icao || '').toUpperCase();
        const list = quotesByAirline.get(alIcao);
        if (!list || list.length === 0) continue;
        if (!byAircraft.has(acIcao)) {
          byAircraft.set(acIcao, { quotes: [], airlines: new Set() });
        }
        const slot = byAircraft.get(acIcao);
        for (const q of list) slot.quotes.push(q);
        slot.airlines.add(alIcao);
      }

      for (const [acIcao, { quotes: qs, airlines }] of byAircraft) {
        // Dedupe by quote id (blur expansion can pull the same quote into
        // multiple aircraft slots; stats use unique quotes per aircraft).
        const byId = new Map();
        for (const q of qs) if (!byId.has(q.id)) byId.set(q.id, q.eur);
        const eurs = Array.from(byId.values());
        if (eurs.length < MIN_QUOTES) { counters.skippedThin++; continue; }

        const med = median(eurs);
        const mn  = Math.min(...eurs);
        const mx  = Math.max(...eurs);
        const csv = Array.from(airlines).sort().join(',');

        if (!dryRun) {
          upsert.run(dep_iata, arr_iata, acIcao, med, mn, mx, eurs.length, csv, now);
        }
        counters.bucketsOut++;
      }
    }
  });
  tx();

  return counters;
}

function acquireLockOrExit(lockPath) {
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    let alive = false;
    if (Number.isFinite(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    }
    if (alive) {
      console.error(`[aggregate-gf-prices] previous run still active (pid ${pid}), exiting`);
      process.exit(0);
    }
    fs.unlinkSync(lockPath);
    return acquireLockOrExit(lockPath);
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const lockPath = process.env.AGGREGATE_LOCK || DEFAULT_LOCK;
  acquireLockOrExit(lockPath);

  let runId = null;
  const startedAt = Date.now();
  const appDb = new Database(DEFAULT_APP_DB);
  appDb.exec(`ATTACH DATABASE '${DEFAULT_ACCIDENTS_DB}' AS accidents`);
  const accDb = {
    prepare: (sql) => appDb.prepare(sql.replace('FROM flights', 'FROM accidents.flights')),
  };

  if (!dryRun) {
    const meta = appDb.prepare(`
      INSERT INTO route_aircraft_prices_meta (started_at, status) VALUES (?, 'running')
    `).run(startedAt);
    runId = meta.lastInsertRowid;
  }

  try {
    const counters = aggregate({ appDb, accDb, dryRun, now: startedAt });
    const endedAt = Date.now();
    console.log(`[aggregate-gf-prices] ${dryRun ? 'DRY' : 'OK'} ` +
      `pairs=${counters.pairsProcessed} buckets_in=${counters.bucketsIn} ` +
      `buckets_out=${counters.bucketsOut} quotes=${counters.quotesTotal} ` +
      `skipped_thin=${counters.skippedThin} skipped_no_match=${counters.skippedNoMatch} ` +
      `elapsed_ms=${endedAt - startedAt}`);
    if (runId !== null) {
      appDb.prepare(`
        UPDATE route_aircraft_prices_meta SET
          ended_at=?, pairs_processed=?, buckets_in=?, buckets_out=?,
          quotes_total=?, skipped_thin=?, skipped_no_match=?, status='ok'
        WHERE run_id=?
      `).run(endedAt, counters.pairsProcessed, counters.bucketsIn, counters.bucketsOut,
             counters.quotesTotal, counters.skippedThin, counters.skippedNoMatch, runId);
    }
  } catch (err) {
    console.error('[aggregate-gf-prices] FATAL:', err.message);
    if (runId !== null) {
      appDb.prepare(`UPDATE route_aircraft_prices_meta SET ended_at=?, status='error' WHERE run_id=?`)
           .run(Date.now(), runId);
    }
    process.exitCode = 1;
  } finally {
    appDb.close();
    releaseLock(lockPath);
  }
}

if (require.main === module) main();

module.exports = { aggregate, median };

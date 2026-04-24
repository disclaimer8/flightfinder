'use strict';

// One-shot import of historical aircraft route tuples from MrAirspace/aircraft-flight-schedules
// parquet releases. Uses DuckDB to stream-query each remote parquet via HTTP range requests,
// filter incomplete tracks, map ICAO airport codes to IATA, and bulk-upsert into
// observed_routes with source='historical'.
//
// Run:
//   cd server && HISTORICAL_BOOTSTRAP_CONFIRM=1 node scripts/bootstrapHistoricalRoutes.js
// or to process just one quarter:
//   HISTORICAL_BOOTSTRAP_CONFIRM=1 HISTORICAL_PARQUET_URLS='<url>' node scripts/bootstrapHistoricalRoutes.js
//
// Memory: ~150MB regardless of parquet file size (was 2-3GB with @dsnp/parquetjs which
// loaded row groups whole). DuckDB streams via httpfs extension with predicate pushdown.
//
// Safety guard: when run directly, refuses without explicit env confirmation.
// When require()'d (e.g. by tests) the guard is skipped so helpers are importable.

const duckdb      = require('duckdb');
const openFlights = require('../src/services/openFlightsService');
const dbModule    = require('../src/models/db');

// Release URLs from MrAirspace/aircraft-flight-schedules GitHub releases (verified
// live 2026-04-24 + schema inspected via DuckDB DESCRIBE).
//
// Schema facts per release type:
//   - aircraft_flight_schedules_<year>_quarter<N> → <YEAR>_Q<N>_detailed_github.parquet
//     2025 Q1 – 2026 Q1. AC_Type populated (~96% of rows). USE THESE.
//   - aircraft_flight_logs_<year>_quarter<N>      → <YEAR>_Q<N>_github.parquet
//     2024 Q1 – Q4. AC_Type is '-' for ALL rows. Useless for our (dep, arr, ac_type) schema.
//     DROPPED.
//
// Data format quirk: ApplicableAirports is stored as Python-repr strings like
// "['EHAM', 'EHRD']" or "-" for missing. We extract the first 4-char ICAO with a
// DuckDB regex.
//
// Total ~4.0 GB across 5 files. Listed newest-first.
const DEFAULT_URLS = [
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2026_quarter1/2026_Q1_detailed_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter4/2025_Q4_detailed_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter3/2025_Q3_detailed_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter2/2025_Q2_detailed_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter1/2025_Q1_detailed_github.parquet',
];

/**
 * Parse an ISO date string to milliseconds epoch.
 * Returns null if unparseable.
 * Exported for unit tests.
 */
function parseDateToMs(iso) {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : null;
}

let _duckDb = null;
let _duckConn = null;

/** Lazy-init DuckDB in-memory with httpfs extension ready */
async function getDuckConn() {
  if (_duckConn) return _duckConn;
  _duckDb = new duckdb.Database(':memory:');
  _duckConn = _duckDb.connect();
  // httpfs is bundled with recent DuckDB builds; INSTALL is a no-op if already installed,
  // LOAD activates the extension for this session.
  await new Promise((resolve, reject) => {
    _duckConn.exec("INSTALL httpfs; LOAD httpfs;", (err) => err ? reject(err) : resolve());
  });
  return _duckConn;
}

/**
 * Stream-query one remote parquet and upsert rows into observed_routes.
 * DuckDB reads via HTTP range requests — no full download, no temp file.
 * Memory: ~150MB regardless of parquet size.
 */
async function importParquet(url) {
  console.log(`[historical] streaming ${url} ...`);
  const conn = await getDuckConn();

  // Predicate pushdown: WHERE clause filters at parquet scan time.
  // ApplicableAirports are Python-repr strings "['EHAM', 'EHRD']" or "-" for missing.
  // regexp_extract with pattern '[A-Z]{4}' pulls the first 4-char ICAO from the list.
  const sql = `
    SELECT
      regexp_extract(Track_Origin_ApplicableAirports,      '[A-Z]{4}', 0) AS origin_icao,
      regexp_extract(Track_Destination_ApplicableAirports, '[A-Z]{4}', 0) AS dest_icao,
      UPPER(TRIM(CAST(AC_Type AS VARCHAR)))  AS ac_type,
      UPPER(TRIM(CAST(Airline AS VARCHAR)))  AS airline,
      Track_Origin_DateTime_UTC               AS seen_at_iso
    FROM read_parquet('${url.replace(/'/g, "''")}')
    WHERE AC_Type IS NOT NULL
      AND AC_Type NOT IN ('-', '')
      AND Track_Origin_ApplicableAirports IS NOT NULL
      AND Track_Origin_ApplicableAirports <> '-'
      AND Track_Destination_ApplicableAirports IS NOT NULL
      AND Track_Destination_ApplicableAirports <> '-'
  `;

  let processed = 0, imported = 0, skipped = 0;
  let rowErrors = 0;

  // Use conn.stream() — more reliable than conn.each() in node-duckdb binding.
  // stream returns an async iterator of row batches.
  const stream = conn.stream(sql);
  for await (const row of stream) {
    try {
      processed++;

      const origin  = row.origin_icao;
      const dest    = row.dest_icao;
      const acType  = row.ac_type;
      const airline = row.airline || '';
      const seenAt  = parseDateToMs(row.seen_at_iso);

      if (!origin || !dest || !acType || !seenAt) { skipped++; continue; }

      const depIata = openFlights.iataForIcao(origin);
      const arrIata = openFlights.iataForIcao(dest);
      if (!depIata || !arrIata) { skipped++; continue; }

      // Airlines in this dataset use ICAO codes (DLH, BAW), not IATA (LH, BA).
      // Store only clean 2-char IATA codes; leave ICAO mapping as follow-up.
      const airlineIata = airline.length === 2 ? airline : null;

      dbModule.upsertObservedRoute({
        depIata,
        arrIata,
        aircraftIcao: acType,
        airlineIata,
        source: 'historical',
      });
      imported++;

      if (processed % 100_000 === 0) {
        const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
        console.log(`[historical]   ${processed.toLocaleString()} processed, ${imported.toLocaleString()} imported, ${skipped.toLocaleString()} skipped, RSS=${rss}MB`);
      }
    } catch (err) {
      rowErrors++;
      if (rowErrors < 5) console.warn(`[historical] row error: ${err.message}`);
    }
  }
  if (rowErrors > 0) console.warn(`[historical] total row errors: ${rowErrors}`);

  console.log(
    `[historical] done ${url}\n` +
    `  total=${processed.toLocaleString()} imported=${imported.toLocaleString()} skipped=${skipped.toLocaleString()}`
  );
  return { processed, imported, skipped };
}

async function main() {
  const envUrls = (process.env.HISTORICAL_PARQUET_URLS || '').split(',').filter(Boolean);
  const list = envUrls.length ? envUrls : DEFAULT_URLS;

  if (!list.length) {
    console.error('[historical] No parquet URLs. Set HISTORICAL_PARQUET_URLS env or update DEFAULT_URLS in this script.');
    process.exit(1);
  }

  console.log(`[historical] Starting bootstrap: ${list.length} quarter(s) to process`);
  const beforeStats = dbModule.observedStats();
  console.log(`[historical] observed_routes before: ${beforeStats.total.toLocaleString()} rows`);

  let totalImported = 0;
  for (const url of list) {
    try {
      const result = await importParquet(url);
      totalImported += result.imported;
    } catch (err) {
      console.warn(`[historical] FAILED ${url}: ${err.message}`);
    }
  }

  const afterStats = dbModule.observedStats();
  console.log(
    `[historical] Bootstrap complete.\n` +
    `  observed_routes after: ${afterStats.total.toLocaleString()} rows\n` +
    `  delta: +${(afterStats.total - beforeStats.total).toLocaleString()} unique route tuples\n` +
    `  aircraft types: ${afterStats.aircraft_types}\n` +
    `  airports: ${afterStats.airports}`
  );

  if (_duckDb) {
    try { _duckDb.close(); } catch {}
  }
}

// Exported for unit tests
module.exports = { parseDateToMs };

// Only run when executed directly (not when require()'d by tests)
if (require.main === module) {
  if (process.env.HISTORICAL_BOOTSTRAP_CONFIRM !== '1') {
    console.log('HISTORICAL_BOOTSTRAP_CONFIRM not set. Refusing to run.');
    console.log('Set HISTORICAL_BOOTSTRAP_CONFIRM=1 to proceed.');
    process.exit(1);
  }
  main().catch(e => {
    console.error('[historical] fatal:', e);
    process.exit(1);
  });
}

'use strict';

// One-shot import of historical aircraft route tuples from MrAirspace/aircraft-flight-schedules
// parquet releases. Reads parquet URL list from env or hardcoded DEFAULT_URLS. Streams each
// file, filters incomplete tracks, maps ICAO airport codes to IATA, bulk-upserts into
// observed_routes with source='historical'.
//
// Run:
//   cd server && HISTORICAL_BOOTSTRAP_CONFIRM=1 node scripts/bootstrapHistoricalRoutes.js
// or to process just one quarter:
//   HISTORICAL_BOOTSTRAP_CONFIRM=1 HISTORICAL_PARQUET_URLS='<url>' node scripts/bootstrapHistoricalRoutes.js
//
// Safety guard: when run directly, refuses without explicit env confirmation.
// When require()'d (e.g. by tests) the guard is skipped so helpers are importable.

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { ParquetReader } = require('@dsnp/parquetjs');
const openFlights = require('../src/services/openFlightsService');
const dbModule    = require('../src/models/db');

// Release URLs from MrAirspace/aircraft-flight-schedules GitHub releases.
// Verified live 2026-04-24 via `gh api /repos/MrAirspace/aircraft-flight-schedules/releases`.
// Filename patterns per release:
//   - aircraft_flight_schedules_<year>_quarter<N> → <YEAR>_Q<N>_detailed_github.parquet (2025 Q1 – 2026 Q1)
//   - aircraft_flight_logs_<year>_quarter<N>      → <YEAR>_Q<N>_github.parquet           (2024 Q1 – Q4)
// Total ~5.2 GB across 9 files. Listed newest-first so interrupted runs get recent data.
const DEFAULT_URLS = [
  // 2026
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2026_quarter1/2026_Q1_detailed_github.parquet',
  // 2025 (detailed versions)
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter4/2025_Q4_detailed_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter3/2025_Q3_detailed_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter2/2025_Q2_detailed_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_schedules_2025_quarter1/2025_Q1_detailed_github.parquet',
  // 2024 (logs versions — detailed not published for this year)
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_logs_2024_quarter4/2024_Q4_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_logs_2024_quarter3/2024_Q3_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_logs_2024_quarter2/2024_Q2_github.parquet',
  'https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/aircraft_flight_logs_2024_quarter1/2024_Q1_github.parquet',
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

/**
 * Download a URL to a temp file, following up to maxRedirects HTTP redirects.
 * Returns the temp file path. Caller is responsible for cleanup.
 */
async function downloadToTempFile(url, maxRedirects = 10) {
  if (maxRedirects <= 0) throw new Error(`Too many redirects for ${url}`);

  const tmpPath = path.join(
    os.tmpdir(),
    `mras-${Date.now()}-${Math.random().toString(36).slice(2)}.parquet`
  );

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;
    const file = fs.createWriteStream(tmpPath);

    transport.get(url, (res) => {
      // Follow redirects (GitHub release assets redirect to objects storage).
      // Recursion returns its OWN tmpPath — pass it through via resolve so
      // the outer caller gets the real downloaded file, not our (deleted) one.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(tmpPath); } catch {}
        downloadToTempFile(res.headers.location, maxRedirects - 1)
          .then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(tmpPath); } catch {}
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(tmpPath)));
      file.on('error', (err) => {
        try { fs.unlinkSync(tmpPath); } catch {}
        reject(err);
      });
    }).on('error', (err) => {
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(err);
    });
  });
}

/**
 * Process one parquet file: download → stream → filter → map → upsert.
 */
async function importParquet(url) {
  console.log(`[historical] downloading ${url} ...`);
  const tmpPath = await downloadToTempFile(url);
  try {
    const reader = await ParquetReader.openFile(tmpPath);
    const cursor = reader.getCursor();
    let processed = 0, imported = 0, skipped = 0;
    let record;

    while ((record = await cursor.next())) {
      processed++;

      const depIcao = String(record.Track_Origin_ApplicableAirports || '').trim().toUpperCase();
      const arrIcao = String(record.Track_Destination_ApplicableAirports || '').trim().toUpperCase();
      const acType  = String(record.AC_Type || '').trim().toUpperCase();
      const airline = String(record.Airline || '').trim().toUpperCase();
      const seenAt  = parseDateToMs(record.Track_Origin_DateTime_UTC);

      // Skip incomplete tracks (missing endpoints, no aircraft type, or no timestamp)
      if (!depIcao || depIcao === '-' || !arrIcao || arrIcao === '-' || !acType || !seenAt) {
        skipped++;
        continue;
      }

      // MrAirspace "ApplicableAirports" can be multi-airport "EHAM|EHRD" — take first (nearest).
      const depIata = openFlights.iataForIcao(depIcao.split('|')[0]);
      const arrIata = openFlights.iataForIcao(arrIcao.split('|')[0]);
      if (!depIata || !arrIata) {
        skipped++;
        continue;
      }

      // Airlines in this dataset use ICAO codes (DLH, BAW), not IATA (LH, BA).
      // We only store airline if it looks like a 2-char IATA code.
      // Follow-up: add ICAO-airline → IATA lookup if needed.
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
        console.log(`[historical]   ${processed.toLocaleString()} processed, ${imported.toLocaleString()} imported, ${skipped.toLocaleString()} skipped`);
      }
    }

    await reader.close();
    console.log(
      `[historical] done ${url}\n` +
      `  total=${processed.toLocaleString()} imported=${imported.toLocaleString()} skipped=${skipped.toLocaleString()}`
    );
    return { processed, imported, skipped };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
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

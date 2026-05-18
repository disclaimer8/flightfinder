'use strict';

/**
 * sync-jonty.js
 *
 * Mirrors https://github.com/Jonty/airline-route-data into server/data/jonty.db.
 *
 * Usage:
 *   node server/scripts/sync-jonty.js [--dry-run] [--db /path/to/jonty.db]
 *
 * ETag-checked so daily cron is cheap when source hasn't refreshed (~weekly).
 */

const https = require('node:https');
const path  = require('node:path');

const SOURCE_URL =
  'https://raw.githubusercontent.com/Jonty/airline-route-data/main/airline_routes.json';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS airports (
  iata          TEXT PRIMARY KEY,
  icao          TEXT,
  name          TEXT,
  city          TEXT,
  country       TEXT,
  country_code  TEXT,
  continent     TEXT,
  latitude      REAL,
  longitude     REAL,
  elevation     INTEGER,
  timezone      TEXT,
  display_name  TEXT
);
CREATE INDEX IF NOT EXISTS idx_airports_country ON airports(country_code);

CREATE TABLE IF NOT EXISTS routes (
  origin_iata   TEXT NOT NULL,
  dest_iata     TEXT NOT NULL,
  km            INTEGER,
  duration_min  INTEGER,
  PRIMARY KEY (origin_iata, dest_iata)
);
CREATE INDEX IF NOT EXISTS idx_routes_dest ON routes(dest_iata);

CREATE TABLE IF NOT EXISTS route_carriers (
  origin_iata   TEXT NOT NULL,
  dest_iata     TEXT NOT NULL,
  carrier_iata  TEXT NOT NULL,
  carrier_name  TEXT,
  PRIMARY KEY (origin_iata, dest_iata, carrier_iata)
);
CREATE INDEX IF NOT EXISTS idx_route_carriers_carrier ON route_carriers(carrier_iata, origin_iata);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Perform an HTTP HEAD request and resolve with the response headers.
 * Rejects on network error or non-2xx status.
 */
function httpHead(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD' }, (res) => {
      // consume body (none expected on HEAD, but drain anyway)
      res.resume();
      res.on('end', () => resolve(res.headers));
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(new Error('HEAD timeout')); });
    req.end();
  });
}

/**
 * Perform an HTTP GET, follow redirects (up to 5), resolve with
 * { body: Buffer, headers }.  Rejects after 60 s.
 */
function httpGet(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          return reject(new Error('Too many redirects'));
        }
        return resolve(httpGet(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ body: Buffer.concat(chunks), headers: res.headers }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => { req.destroy(new Error('GET timeout')); });
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates top-level shape of parsed JSON.
 * Returns { ok: true } or { ok: false, message: string }.
 */
function validateShape(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, message: 'Top-level must be a plain object keyed by IATA codes' };
  }
  const badKeys = [];
  for (const key of Object.keys(data)) {
    if (typeof key !== 'string') {
      badKeys.push(String(key));
      if (badKeys.length >= 3) break;
      continue;
    }
    const entry = data[key];
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.iata !== 'string' ||
      typeof entry.name !== 'string' ||
      !Array.isArray(entry.routes)
    ) {
      badKeys.push(key);
      if (badKeys.length >= 3) break;
    }
  }
  if (badKeys.length > 0) {
    return { ok: false, message: `Validation failed for keys: ${badKeys.join(', ')}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Core import function (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Atomically refresh jonty.db from a parsed JSON object.
 *
 * @param {object} jsonData  - Parsed airline_routes.json
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]
 * @param {string} [opts.etag]
 * @param {number} [opts.sizeBytes]
 * @returns {{ airports: number, routes: number, carriers: number }}
 */
function runImport(jsonData, db, opts = {}) {
  const { etag = '', sizeBytes = 0 } = opts;

  // Ensure schema exists (idempotent)
  db.exec(SCHEMA);

  const insertAirport = db.prepare(`
    INSERT OR REPLACE INTO airports
      (iata, icao, name, city, country, country_code, continent,
       latitude, longitude, elevation, timezone, display_name)
    VALUES
      (@iata, @icao, @name, @city, @country, @country_code, @continent,
       @latitude, @longitude, @elevation, @timezone, @display_name)
  `);

  const insertRoute = db.prepare(`
    INSERT OR REPLACE INTO routes
      (origin_iata, dest_iata, km, duration_min)
    VALUES
      (@origin_iata, @dest_iata, @km, @duration_min)
  `);

  const insertCarrier = db.prepare(`
    INSERT OR REPLACE INTO route_carriers
      (origin_iata, dest_iata, carrier_iata, carrier_name)
    VALUES
      (@origin_iata, @dest_iata, @carrier_iata, @carrier_name)
  `);

  const upsertMeta = db.prepare(`
    INSERT OR REPLACE INTO meta (key, value) VALUES (@key, @value)
  `);

  let airportCount = 0;
  let routeCount   = 0;
  let carrierCount = 0;

  const doImport = db.transaction(() => {
    // Full refresh
    db.exec('DELETE FROM airports; DELETE FROM routes; DELETE FROM route_carriers;');

    for (const [, entry] of Object.entries(jsonData)) {
      insertAirport.run({
        iata:         entry.iata          ?? null,
        icao:         entry.icao          ?? null,
        name:         entry.name          ?? null,
        city:         entry.city_name     ?? null,
        country:      entry.country       ?? null,
        country_code: entry.country_code  ?? null,
        continent:    entry.continent     ?? null,
        latitude:     entry.latitude      != null ? parseFloat(entry.latitude)  : null,
        longitude:    entry.longitude     != null ? parseFloat(entry.longitude) : null,
        elevation:    entry.elevation     != null ? parseInt(entry.elevation, 10) : null,
        timezone:     entry.timezone      ?? null,
        display_name: entry.display_name  ?? null,
      });
      airportCount++;

      const origin = entry.iata;
      for (const route of (entry.routes || [])) {
        const dest = route.iata;
        if (!dest) continue;

        insertRoute.run({
          origin_iata:  origin,
          dest_iata:    dest,
          km:           route.km   != null ? parseInt(route.km, 10)  : null,
          duration_min: route.min  != null ? parseInt(route.min, 10) : null,
        });
        routeCount++;

        for (const carrier of (route.carriers || [])) {
          if (!carrier.iata) continue;
          insertCarrier.run({
            origin_iata:  origin,
            dest_iata:    dest,
            carrier_iata: carrier.iata,
            carrier_name: carrier.name ?? null,
          });
          carrierCount++;
        }
      }
    }

    const now = new Date().toISOString();
    for (const [key, value] of [
      ['source_etag',      etag],
      ['last_sync_utc',    now],
      ['source_size_bytes', String(sizeBytes)],
      ['airport_count',    String(airportCount)],
      ['route_count',      String(routeCount)],
      ['carrier_count',    String(carrierCount)],
    ]) {
      upsertMeta.run({ key, value });
    }
  });

  doImport();

  return { airports: airportCount, routes: routeCount, carriers: carrierCount };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dbIdx  = args.indexOf('--db');
  const dbPath = dbIdx !== -1 && args[dbIdx + 1]
    ? args[dbIdx + 1]
    : path.join(__dirname, '..', 'data', 'jonty.db');

  // --- 1. Read existing etag from DB ---
  let storedEtag = null;
  if (!dryRun) {
    try {
      const Database = require('better-sqlite3');
      const existing = new Database(dbPath, { readonly: true });
      try {
        const row = existing.prepare("SELECT value FROM meta WHERE key='source_etag'").get();
        if (row) storedEtag = row.value;
      } catch {
        // table may not exist yet — that's fine
      }
      existing.close();
    } catch {
      // DB might not exist yet
    }
  }

  // --- 2. HEAD request for ETag ---
  let currentEtag = null;
  try {
    const headHeaders = await httpHead(SOURCE_URL);
    currentEtag = headHeaders.etag || null;
    if (currentEtag && currentEtag === storedEtag) {
      console.log(`jonty unchanged (etag=${currentEtag}), skipping`);
      process.exit(0);
    }
  } catch (err) {
    console.warn(`[sync-jonty] HEAD request failed (${err.message}), falling through to GET`);
  }

  // --- 3. GET the JSON ---
  let body, responseHeaders;
  try {
    ({ body, headers: responseHeaders } = await httpGet(SOURCE_URL));
  } catch (err) {
    console.error(`[sync-jonty] GET failed: ${err.message}`);
    process.exit(1);
  }

  const etag      = currentEtag || responseHeaders.etag || '';
  const sizeBytes = body.length;

  // --- 4. Parse + validate ---
  let jsonData;
  try {
    jsonData = JSON.parse(body.toString('utf8'));
  } catch (err) {
    console.error(`[sync-jonty] JSON parse error: ${err.message}`);
    process.exit(1);
  }

  const validation = validateShape(jsonData);
  if (!validation.ok) {
    console.error(`[sync-jonty] Validation error: ${validation.message}`);
    process.exit(1);
  }

  const airportCount  = Object.keys(jsonData).length;
  const routeCount    = Object.values(jsonData).reduce((s, e) => s + (e.routes?.length || 0), 0);
  const carrierCount  = Object.values(jsonData).reduce(
    (s, e) => s + (e.routes || []).reduce((rs, r) => rs + (r.carriers?.length || 0), 0), 0
  );

  // --- Dry run: report and exit ---
  if (dryRun) {
    console.log(
      `[sync-jonty] DRY RUN — would insert: ${airportCount} airports, ` +
      `${routeCount} routes, ${carrierCount} carriers ` +
      `(etag=${etag}, size=${sizeBytes} bytes)`
    );
    process.exit(0);
  }

  // --- 5-7. Open DB, apply schema, atomic transaction ---
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  const t0 = Date.now();
  let result;
  try {
    result = runImport(jsonData, db, { etag, sizeBytes });
  } catch (err) {
    console.error(`[sync-jonty] Transaction failed: ${err.message}`);
    db.close();
    process.exit(1);
  }

  db.close();
  const tookS = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `jonty synced: ${result.airports} airports, ${result.routes} routes, ` +
    `${result.carriers} carriers (etag=${etag}, took ${tookS}s)`
  );
}

// Export for tests + allow direct invocation
module.exports = { runImport, validateShape, SCHEMA };

if (require.main === module) {
  main().catch((err) => {
    console.error(`[sync-jonty] Unexpected error: ${err.message}`);
    process.exit(1);
  });
}

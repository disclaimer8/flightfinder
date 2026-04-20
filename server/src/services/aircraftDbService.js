'use strict';

const https = require('https');
const db = require('../models/db');

// Public aircraft database: Mictronics readsb aircrafts.json
//   { "<hex>": { "r": "<reg>", "t": "<icao_type>", "f": "<flags>", "d": "<long_name>" }, ... }
// ~500k entries, ~28 MB plain JSON. Permissively-licensed (readsb is GPLv2).
// Streamed once at server boot, cached in our local aircraft_db table.
const AIRCRAFT_DB_URL = 'https://raw.githubusercontent.com/Mictronics/readsb/master/webapp/src/db/aircrafts.json';

const BOOTSTRAP_MIN_ROWS = 400000; // threshold below which we refetch on boot
const BATCH_SIZE = 5000;            // rows per transaction chunk

/** Download a URL and return its entire body as a UTF-8 string. Follows redirects (up to 5). */
function downloadText(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return downloadText(res.headers.location, redirectsLeft - 1).then(resolve, reject);
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${status} from ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(Buffer.concat(chunks).toString('utf8'));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => {
      req.destroy(new Error(`Timeout downloading ${url}`));
    });
  });
}

/**
 * Parse the Mictronics dict into plain row objects.
 * Input:  { "000005": { r:"5N-BXF", t:"E145", ... }, ... }
 * Output: [{ hex:"000005", reg:"5N-BXF", icaoType:"E145" }, ...]
 * Hex is lower-cased to match our PK convention.
 */
function parseMictronicsDict(dict) {
  const rows = [];
  if (!dict || typeof dict !== 'object') return rows;
  for (const rawHex of Object.keys(dict)) {
    const v = dict[rawHex];
    if (!v || typeof v !== 'object') continue;
    const hex = String(rawHex).toLowerCase();
    if (!hex) continue;
    rows.push({
      hex,
      reg: typeof v.r === 'string' && v.r ? v.r : null,
      icaoType: typeof v.t === 'string' && v.t ? v.t : null,
    });
  }
  return rows;
}

/**
 * Bootstrap the aircraft_db table from the upstream dataset.
 * Idempotent: a no-op when aircraftDbSize() already exceeds BOOTSTRAP_MIN_ROWS
 * (unless opts.force === true). Runs the actual insert in BATCH_SIZE chunks
 * inside a prepared transaction for speed.
 *
 * @param {{force?: boolean, url?: string}} [opts]
 * @returns {Promise<{inserted:number, skipped:boolean, size:number}>}
 */
async function bootstrap(opts = {}) {
  const force = !!opts.force;
  const url = opts.url || AIRCRAFT_DB_URL;

  const existing = db.aircraftDbSize();
  if (!force && existing > BOOTSTRAP_MIN_ROWS) {
    console.log(`[aircraftdb] bootstrap skipped — ${existing} rows already present`);
    return { inserted: 0, skipped: true, size: existing };
  }

  console.log(`[aircraftdb] bootstrap starting (existing=${existing}, url=${url})`);
  const body = await downloadText(url);
  const dict = JSON.parse(body);
  const rows = parseMictronicsDict(dict);
  if (!rows.length) {
    console.warn('[aircraftdb] upstream dataset returned 0 parseable rows');
    return { inserted: 0, skipped: false, size: existing };
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    db.bulkUpsertAircraft(batch);
    inserted += batch.length;
  }

  const size = db.aircraftDbSize();
  console.log(`[aircraftdb] bootstrap done — inserted ${inserted}, size now ${size}`);
  return { inserted, skipped: false, size };
}

/**
 * Resolve a Mode-S / ICAO24 hex to an aircraft record.
 * Returns `{ icaoType, reg }` when known, otherwise null.
 * Callers must gracefully handle null (e.g. aircraft DB not populated yet).
 */
function resolveIcaoType(hex) {
  const row = db.getAircraftByHex(hex);
  if (!row) return null;
  return {
    icaoType: row.icao_type || null,
    reg: row.reg || null,
  };
}

module.exports = {
  bootstrap,
  resolveIcaoType,
  _parseMictronicsDict: parseMictronicsDict, // exported for tests
  _downloadText: downloadText,               // exported for tests
  BOOTSTRAP_MIN_ROWS,
};

'use strict';
const { db } = require('./db');

const FRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const BATCH_SIZE = 5000;

const stmts = {
  upsert: db.prepare(`
    INSERT INTO faa_registry (n_number, icao24_hex, manufacturer, model, year_built, owner_name, updated_at)
    VALUES (@n_number, @icao24_hex, @manufacturer, @model, @year_built, @owner_name, @updated_at)
    ON CONFLICT(n_number) DO UPDATE SET
      icao24_hex   = excluded.icao24_hex,
      manufacturer = excluded.manufacturer,
      model        = excluded.model,
      year_built   = excluded.year_built,
      owner_name   = excluded.owner_name,
      updated_at   = excluded.updated_at
  `),
  getByNNumber: db.prepare('SELECT * FROM faa_registry WHERE n_number = ?'),
  size:         db.prepare('SELECT COUNT(*) AS n FROM faa_registry'),
  latestUpdate: db.prepare('SELECT MAX(updated_at) AS ts FROM faa_registry'),
};

const _upsertBatch = db.transaction((rows) => {
  for (const r of rows) stmts.upsert.run(r);
});

/**
 * Bulk-upsert an array of faa_registry row objects.
 * Runs in BATCH_SIZE chunks for memory efficiency.
 * @param {Array<object>} rows
 * @returns {number} count of rows processed
 */
function upsertMany(rows) {
  if (!rows || !rows.length) return 0;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    _upsertBatch(batch);
    total += batch.length;
  }
  return total;
}

/**
 * Look up a registration number. Input is normalised to uppercase.
 * @param {string} nNumber  e.g. 'N12345' or '12345'
 * @returns {object|null}
 */
function getByNNumber(nNumber) {
  if (!nNumber) return null;
  const key = String(nNumber).toUpperCase().startsWith('N')
    ? String(nNumber).toUpperCase()
    : `N${String(nNumber).toUpperCase()}`;
  return stmts.getByNNumber.get(key) || null;
}

/**
 * Returns true if the table has any row updated within the last 24h.
 * Used by bootstrap() to skip unnecessary re-downloads.
 */
function isFresh() {
  const row = stmts.latestUpdate.get();
  if (!row || !row.ts) return false;
  return Date.now() - row.ts < FRESH_THRESHOLD_MS;
}

function size() {
  return stmts.size.get().n;
}

module.exports = { upsertMany, getByNNumber, isFresh, size };

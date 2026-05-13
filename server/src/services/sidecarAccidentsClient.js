'use strict';

const fs = require('node:fs');

let _db = null;
let _stmts = null;
let _initAttempted = false;

function getDb() {
  if (_db) return _db;
  if (process.env.NODE_ENV === 'test') return null;
  const path = process.env.SIDECAR_ACCIDENTS_DB
    || '/root/flightfinder/data/accidents.db';
  if (!fs.existsSync(path)) return null;
  try {
    const Database = require('better-sqlite3');
    _db = new Database(path, { readonly: true, fileMustExist: true });
    return _db;
  } catch (e) {
    console.warn('[sidecarAccidentsClient] open failed:', e.message);
    return null;
  }
}

function getStmts() {
  if (_stmts || _initAttempted) return _stmts;
  _initAttempted = true;
  const d = getDb();
  if (!d) return null;
  _stmts = {
    byId: d.prepare(`SELECT id, date, normalized_date, aircraft_model, operator, fatalities, location,
                            source_url, lat, lon FROM accidents WHERE id = ?`),
    byEventId_ntsb: d.prepare(`
      SELECT id FROM accidents
      WHERE source_url LIKE '%/event/' || ? || '%'
         OR source_url LIKE '%/event/' || ?
      LIMIT 1
    `),
    byEventId_wikidata: d.prepare(`
      SELECT id FROM accidents
      WHERE source_url LIKE '%/wiki/' || ? || '%'
         OR source_url LIKE '%/wiki/' || ?
      LIMIT 1
    `),
    allNtsbUrls: d.prepare(`
      SELECT id, source_url, normalized_date, aircraft_model, operator, location
      FROM accidents
      WHERE source_url LIKE '%carol.ntsb.gov/event/%'
    `),
    // Selects normalized_date so the AirCrash adapter can produce a valid
    // occurred_at epoch; without it, related-event lists render as
    // 1970-01-01 in the UI because parseDateToEpoch sees undefined.
    byAircraft: d.prepare(`
      SELECT id, date, normalized_date, aircraft_model, operator, fatalities,
             location, source_url
      FROM accidents
      WHERE LOWER(aircraft_model) LIKE '%' || LOWER(?) || '%' AND id != ?
      ORDER BY
        CASE WHEN normalized_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             THEN 0 ELSE 1 END,
        normalized_date DESC
      LIMIT 5
    `),
    byOperator: d.prepare(`
      SELECT id, date, normalized_date, aircraft_model, operator, fatalities,
             location, source_url
      FROM accidents
      WHERE operator = ? AND id != ?
      ORDER BY
        CASE WHEN normalized_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             THEN 0 ELSE 1 END,
        normalized_date DESC
      LIMIT 5
    `),
  };
  return _stmts;
}

// Per-arity prepared-statement cache for findAccidentsByFamilyPatterns. Each
// pattern needs its own pair of `?` binds (aircraft_model + aircraft_canonical),
// so the SQL shape depends on N. Built lazily so we only prepare arities we
// actually use (typically 1-3 patterns per family).
const _familyStmtCache = { generic: new Map(), fatal: new Map() };
function _prepFamilyStmt(d, patternCount, fatalOnly) {
  const bucket = fatalOnly ? _familyStmtCache.fatal : _familyStmtCache.generic;
  const cached = bucket.get(patternCount);
  if (cached) return cached;

  const orClauses = Array(patternCount).fill(
    "(LOWER(aircraft_model) LIKE '%' || LOWER(?) || '%' OR LOWER(aircraft_canonical) LIKE '%' || LOWER(?) || '%')"
  ).join(' OR ');

  let sql;
  if (fatalOnly) {
    // Fatal events: ALL-time, no LIMIT. Busy families (Boeing 737 = 1.6K
    // rows) would otherwise lose 7-year-old hull losses like Lion Air 2018
    // and Ethiopian 2019 to the date-DESC recency cutoff.
    sql = `
      SELECT id, date, normalized_date, aircraft_model, operator, fatalities,
             location, source_url
      FROM accidents
      WHERE (${orClauses}) AND CAST(fatalities AS INTEGER) > 0
      ORDER BY CAST(fatalities AS INTEGER) DESC,
        CASE WHEN normalized_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             THEN 0 ELSE 1 END,
        normalized_date DESC
    `;
  } else {
    sql = `
      SELECT id, date, normalized_date, aircraft_model, operator, fatalities,
             location, source_url
      FROM accidents
      WHERE ${orClauses}
      ORDER BY
        CASE WHEN normalized_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             THEN 0 ELSE 1 END,
        normalized_date DESC
      LIMIT ?
    `;
  }
  const stmt = d.prepare(sql);
  bucket.set(patternCount, stmt);
  return stmt;
}

function getAccidentById(id) {
  const s = getStmts(); if (!s) return null;
  return s.byId.get(id);
}

function getAccidentIdBySourceEventId(evId, source) {
  // Backward-compat: source defaults to 'ntsb' if not given (existing NTSB worker).
  const s = getStmts(); if (!s) return null;
  const stmt = source === 'wikidata' ? s.byEventId_wikidata : s.byEventId_ntsb;
  const row = stmt.get(evId, evId);
  return row ? row.id : null;
}

function findRelatedByAircraft(modelStr, excludeId) {
  const s = getStmts(); if (!s || !modelStr) return [];
  return s.byAircraft.all(modelStr.split(/\s+/).slice(0, 2).join(' '), excludeId);
}

function findRelatedByOperator(operator, excludeId) {
  const s = getStmts(); if (!s || !operator) return [];
  return s.byOperator.all(operator, excludeId);
}

/**
 * Find AirCrash accidents matching ANY of a set of family-name patterns.
 * Each pattern LIKE-matches against both aircraft_model and aircraft_canonical
 * (so a single pattern of 'Boeing 787' catches both 'BOEING 787-9' and the
 * canonical 'BOEING 787 9' variants).
 *
 * Multi-pattern matters for families whose `name` doesn't itself appear in
 * raw accident text — e.g. 'Embraer E170/E175' needs to be split into
 * ['E170', 'E175'], and 'ATR 42/72' into ['ATR 42', 'ATR 72'].
 *
 * @param {string[]} patterns   Free-text patterns to search.
 * @param {object}   [opts]
 * @param {boolean}  [opts.fatalOnly=false]  Pre-filter in SQL to fatalities > 0,
 *                                            no LIMIT (returns every fatal row).
 * @param {number}   [opts.limit=500]         Applied only when fatalOnly=false.
 */
function findAccidentsByFamilyPatterns(patterns, opts = {}) {
  const s = getStmts(); if (!s) return [];
  const cleanPatterns = (patterns || [])
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (cleanPatterns.length === 0) return [];
  const fatalOnly = !!opts.fatalOnly;
  const limit = Math.max(1, Math.min(2000, opts.limit | 0)) || 500;
  const d = getDb(); if (!d) return [];
  const stmt = _prepFamilyStmt(d, cleanPatterns.length, fatalOnly);
  // Bind order: for each pattern, two `?` (aircraft_model + aircraft_canonical).
  // Then, when generic (not fatal-only), one more `?` for LIMIT.
  const binds = [];
  for (const p of cleanPatterns) { binds.push(p, p); }
  if (!fatalOnly) binds.push(limit);
  return stmt.all(...binds);
}

// Returns Map<ev_id, {accId, normalized_date, aircraft_model, operator, location}>
// for all sidecar rows with a carol.ntsb.gov source URL. Used by the NTSB ingest
// worker (a) to pre-filter CSVs so we don't keep 60K+ non-matching events in
// memory, and (b) to source slug-friendly fields (sidecar has clean
// human-formatted `aircraft_model` like "PIPER PA 28-180" vs the MDB's terse
// "F33A" plus ISO `normalized_date` instead of US MM/DD/YY).
function getNtsbEvIdToAccidentIdMap() {
  const s = getStmts(); if (!s) return new Map();
  const out = new Map();
  for (const row of s.allNtsbUrls.all()) {
    // Source URL pattern: https://carol.ntsb.gov/event/{evId}
    // Comma-merged rows can carry multiple URLs; extract every event ID match.
    const matches = String(row.source_url || '').matchAll(/\/event\/([^,\s/?]+)/g);
    const value = {
      accId: row.id,
      normalized_date: row.normalized_date,
      aircraft_model:  row.aircraft_model,
      operator:        row.operator,
      location:        row.location,
    };
    for (const m of matches) out.set(m[1], value);
  }
  return out;
}

module.exports = {
  getAccidentById, getAccidentIdBySourceEventId,
  findRelatedByAircraft, findRelatedByOperator,
  findAccidentsByFamilyPatterns,
  getNtsbEvIdToAccidentIdMap,
};

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
    byAircraft: d.prepare(`
      SELECT id, date, aircraft_model, operator, location
      FROM accidents
      WHERE LOWER(aircraft_model) LIKE '%' || LOWER(?) || '%' AND id != ?
      ORDER BY
        CASE WHEN normalized_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             THEN 0 ELSE 1 END,
        normalized_date DESC
      LIMIT 5
    `),
    byOperator: d.prepare(`
      SELECT id, date, aircraft_model, operator, location
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
  getNtsbEvIdToAccidentIdMap,
};

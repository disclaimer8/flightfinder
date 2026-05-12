'use strict';

// Read-only access to /root/flightfinder/data/accidents.db (aircrash-sidecar DB).
// In NODE_ENV=test we return nulls — tests mock this module's exports.

let sidecarDb = null;

function getDb() {
  if (sidecarDb) return sidecarDb;
  if (process.env.NODE_ENV === 'test') return null;
  const path = process.env.SIDECAR_ACCIDENTS_DB
    || '/root/flightfinder/data/accidents.db';
  const Database = require('better-sqlite3');
  sidecarDb = new Database(path, { readonly: true, fileMustExist: true });
  return sidecarDb;
}

const stmts = (() => {
  const d = getDb();
  if (!d) return null;
  return {
    byId: d.prepare(`
      SELECT id, date, aircraft_model, operator, fatalities, location,
             source_url, lat, lon
      FROM accidents WHERE id = ?
    `),
    byEventId: d.prepare(`
      SELECT id FROM accidents
      WHERE source_url LIKE '%/event/' || ? || '%'
         OR source_url LIKE '%/event/' || ?
      LIMIT 1
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
})();

function getAccidentById(id) {
  if (!stmts) return null;
  return stmts.byId.get(id);
}
function getAccidentIdBySourceEventId(evId) {
  if (!stmts) return null;
  const row = stmts.byEventId.get(evId, evId);
  return row ? row.id : null;
}
function findRelatedByAircraft(model, excludeId) {
  if (!stmts || !model) return [];
  return stmts.byAircraft.all(model.split(/\s+/).slice(0, 2).join(' '), excludeId);
}
function findRelatedByOperator(operator, excludeId) {
  if (!stmts || !operator) return [];
  return stmts.byOperator.all(operator, excludeId);
}

module.exports = {
  getAccidentById, getAccidentIdBySourceEventId,
  findRelatedByAircraft, findRelatedByOperator,
};

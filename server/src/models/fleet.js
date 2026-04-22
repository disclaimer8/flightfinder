'use strict';
const { db } = require('./db');

const stmts = {
  upsert: db.prepare(`
    INSERT INTO aircraft_fleet (icao24, registration, icao_type, operator_iata, build_year, first_seen_at, updated_at)
    VALUES (@icao24, @registration, @icao_type, @operator_iata, @build_year, @now, @now)
    ON CONFLICT(icao24) DO UPDATE SET
      registration   = COALESCE(excluded.registration, aircraft_fleet.registration),
      icao_type      = COALESCE(excluded.icao_type, aircraft_fleet.icao_type),
      operator_iata  = COALESCE(excluded.operator_iata, aircraft_fleet.operator_iata),
      build_year     = COALESCE(excluded.build_year, aircraft_fleet.build_year),
      updated_at     = excluded.updated_at
  `),
  byIcao24:       db.prepare('SELECT * FROM aircraft_fleet WHERE icao24 = ?'),
  byRegistration: db.prepare('SELECT * FROM aircraft_fleet WHERE registration = ?'),
};

module.exports = {
  upsert(row) { stmts.upsert.run({ now: Date.now(), ...row }); },
  getByIcao24(hex) { return stmts.byIcao24.get(hex?.toLowerCase()); },
  getByRegistration(reg) { return stmts.byRegistration.get(reg?.toUpperCase()); },
};

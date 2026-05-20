'use strict';

// Wave 2 Path B: airlineMeta should emit jonty-aware title/h1 when jonty has
// data for the carrier, and fall back to OpenFlights name/h1 otherwise.
//
// Mocks jontyDb with an in-memory SQLite that contains one carrier (BA) so
// the JOIN in jontyRouteService.getAirlineNetwork() returns a row. Carriers
// not in the fixture (e.g. ZZ) drive the fallback path.

const Database = require('better-sqlite3');

let meta;
beforeAll(() => {
  jest.resetModules();
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`);
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('LHR', 'JFK', 5541, 460);
  // Seed jonty fixture with carrier names that DIFFER from OpenFlights —
  // exact-match assertions on these names prove the jonty branch ran
  // (OpenFlights returns "British Airways" / "Lufthansa", not these).
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('LHR', 'JFK', 'BA', 'British Airways Plc');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('FRA', 'JFK', 'LH', 'Deutsche Lufthansa AG');
  jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
  meta = require('../services/seoMetaService');
});

describe('airlineMeta — Path B jonty-aware title (when jonty has data)', () => {
  test('uses jonty carrier_name + "route network" when jonty hit', () => {
    const m = meta.resolve('/airline/BA');
    expect(m.airlineName).toBe('British Airways Plc');  // jonty fixture name, NOT OpenFlights default
    expect(m.h1).toMatch(/British Airways Plc/);
    expect(m.h1).toMatch(/route network/i);
    expect(m.title).toMatch(/British Airways Plc.*routes & destinations/);  // jonty carrier name proves jonty branch (title template is shared)
  });

  test('uses jonty carrier_name for second carrier (Lufthansa)', () => {
    const m = meta.resolve('/airline/LH');
    expect(m.airlineName).toBe('Deutsche Lufthansa AG');
    expect(m.h1).toMatch(/Deutsche Lufthansa AG/);
    expect(m.h1).toMatch(/route network/i);
  });

  test('falls back to OpenFlights name when jonty has no rows', () => {
    const m = meta.resolve('/airline/ZZ');
    // Either OpenFlights name or "ZZ airline" — but NOT "route network" wording
    expect(m.h1).not.toMatch(/route network/i);
  });
});

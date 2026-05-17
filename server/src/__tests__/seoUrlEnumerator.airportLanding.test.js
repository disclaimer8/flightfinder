'use strict';
const Database = require('better-sqlite3');

function newDb() {
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`);
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('ORK', 'EICK', 'Cork', 'Cork', 'Ireland', 'IE', 'EU', 51.85, -8.49, 502, 'Europe/Dublin', 'Cork (ORK), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LHR', 'EGLL', 'Heathrow', 'London', 'United Kingdom', 'GB', 'EU', 51.47, -0.45, 80, 'Europe/London', 'London (LHR), United Kingdom');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'LHR', 557, 78);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'LHR', 'EI', 'Aer Lingus');
  return db;
}

let enumerator;
beforeAll(() => {
  jest.resetModules();
  const db = newDb();
  jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
  enumerator = require('../services/seoUrlEnumerator');
});

describe('seoUrlEnumerator P1 families', () => {
  it('enumerateAirportLandingUrls returns /flights-from/:iata and /flights-to/:iata for every airport', () => {
    const urls = enumerator.enumerateAirportLandingUrls();
    expect(urls).toContain('/flights-from/ORK');
    expect(urls).toContain('/flights-from/LHR');
    expect(urls).toContain('/flights-to/ORK');
    expect(urls).toContain('/flights-to/LHR');
    expect(urls).toHaveLength(4); // 2 airports × 2 directions
  });

  it('enumerateAirlineNetworkUrls returns /airline/:iata for distinct carriers', () => {
    const urls = enumerator.enumerateAirlineNetworkUrls();
    expect(urls).toContain('/airline/EI');
    expect(urls).toHaveLength(1);
  });

  it('enumerateAirlineAirportUrls returns /airline/:iata/from/:airport for distinct (carrier, origin) pairs', () => {
    const urls = enumerator.enumerateAirlineAirportUrls();
    expect(urls).toContain('/airline/EI/from/ORK');
    expect(urls).toHaveLength(1);
  });

  it('all three return arrays of strings (no objects, no null)', () => {
    for (const fn of [enumerator.enumerateAirportLandingUrls, enumerator.enumerateAirlineNetworkUrls, enumerator.enumerateAirlineAirportUrls]) {
      const urls = fn();
      expect(Array.isArray(urls)).toBe(true);
      for (const u of urls) {
        expect(typeof u).toBe('string');
        expect(u.startsWith('/')).toBe(true);
      }
    }
  });
});

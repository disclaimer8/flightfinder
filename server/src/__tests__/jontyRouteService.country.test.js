'use strict';
const Database = require('better-sqlite3');

let svc;
beforeAll(() => {
  jest.resetModules();
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`);
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('JFK', 'KJFK', 'JFK', 'New York', 'USA', 'US', 'NA', 40.64, -73.78, 13, 'America/New_York', 'New York (JFK)');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LAX', 'KLAX', 'LAX', 'Los Angeles', 'USA', 'US', 'NA', 33.94, -118.41, 38, 'America/Los_Angeles', 'Los Angeles (LAX)');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LHR', 'EGLL', 'Heathrow', 'London', 'UK', 'GB', 'EU', 51.47, -0.45, 80, 'Europe/London', 'London (LHR)');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('JFK', 'LAX', 3983, 360);
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('JFK', 'LHR', 5541, 480);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('JFK', 'LAX', 'AA', 'American');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('JFK', 'LAX', 'DL', 'Delta');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('JFK', 'LHR', 'BA', 'British Airways');
  jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
  svc = require('../services/jontyRouteService');
});

describe('getCountryStats(cc)', () => {
  test('returns stats for country with airports', () => {
    const stats = svc.getCountryStats('US');
    expect(stats).toBeTruthy();
    expect(stats.code).toBe('US');
    expect(stats.airportCount).toBe(2);
    expect(stats.topAirports.length).toBeGreaterThan(0);
    expect(stats.topAirports[0].iata).toBe('JFK'); // JFK has 2 outbound routes
    expect(stats.topAirlines.some(a => a.iata === 'AA' || a.iata === 'DL' || a.iata === 'BA')).toBe(true);
  });

  test('returns null for country with no airports', () => {
    const stats = svc.getCountryStats('ZZ');
    expect(stats).toBeNull();
  });

  test('country code is case-insensitive', () => {
    const stats = svc.getCountryStats('us');
    expect(stats).toBeTruthy();
    expect(stats.code).toBe('US');
  });
});

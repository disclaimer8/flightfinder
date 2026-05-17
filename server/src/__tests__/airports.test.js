'use strict';

/**
 * Integration tests for GET /api/airports and GET /api/airports/:iata.
 *
 * Strategy: open an in-memory better-sqlite3 DB, apply the Jonty schema
 * (imported from sync-jonty.js), seed fixtures, then monkey-patch
 * jontyDb.getDb() to return the in-memory handle before requiring the app.
 */

const Database = require('better-sqlite3');
const request  = require('supertest');
const { SCHEMA } = require('../../scripts/sync-jonty');

// ---------------------------------------------------------------------------
// Build an in-memory DB with fixtures
// ---------------------------------------------------------------------------

function buildFixtureDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);

  // Airports
  const insertAirport = db.prepare(`
    INSERT INTO airports
      (iata, icao, name, city, country, country_code, continent,
       latitude, longitude, elevation, timezone, display_name)
    VALUES
      (@iata, @icao, @name, @city, @country, @country_code, @continent,
       @latitude, @longitude, @elevation, @timezone, @display_name)
  `);

  const airports = [
    {
      iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London',
      country: 'United Kingdom', country_code: 'GB', continent: 'EU',
      latitude: 51.469603, longitude: -0.453566, elevation: 80,
      timezone: 'Europe/London', display_name: 'London (LHR), United Kingdom',
    },
    {
      iata: 'LGW', icao: 'EGKK', name: 'Gatwick', city: 'London',
      country: 'United Kingdom', country_code: 'GB', continent: 'EU',
      latitude: 51.148056, longitude: -0.190278, elevation: 62,
      timezone: 'Europe/London', display_name: 'London (LGW), United Kingdom',
    },
    {
      iata: 'DUB', icao: 'EIDW', name: 'Dublin Airport', city: 'Dublin',
      country: 'Ireland', country_code: 'IE', continent: 'EU',
      latitude: 53.421333, longitude: -6.270075, elevation: 242,
      timezone: 'Europe/Dublin', display_name: 'Dublin (DUB), Ireland',
    },
    {
      iata: 'CDG', icao: 'LFPG', name: 'Charles de Gaulle', city: 'Paris',
      country: 'France', country_code: 'FR', continent: 'EU',
      latitude: 49.012779, longitude: 2.55, elevation: 119,
      timezone: 'Europe/Paris', display_name: 'Paris (CDG), France',
    },
    {
      iata: 'AMS', icao: 'EHAM', name: 'Schiphol', city: 'Amsterdam',
      country: 'Netherlands', country_code: 'NL', continent: 'EU',
      latitude: 52.308601, longitude: 4.763889, elevation: -11,
      timezone: 'Europe/Amsterdam', display_name: 'Amsterdam (AMS), Netherlands',
    },
  ];
  for (const a of airports) insertAirport.run(a);

  // Routes from LHR
  db.prepare(`
    INSERT INTO routes (origin_iata, dest_iata, km, duration_min) VALUES (?, ?, ?, ?)
  `).run('LHR', 'AMS', 371, 80);
  db.prepare(`
    INSERT INTO routes (origin_iata, dest_iata, km, duration_min) VALUES (?, ?, ?, ?)
  `).run('LHR', 'CDG', 341, 75);

  // Carriers for LHR → AMS
  db.prepare(`
    INSERT INTO route_carriers (origin_iata, dest_iata, carrier_iata, carrier_name)
    VALUES (?, ?, ?, ?)
  `).run('LHR', 'AMS', 'BA', 'British Airways');
  db.prepare(`
    INSERT INTO route_carriers (origin_iata, dest_iata, carrier_iata, carrier_name)
    VALUES (?, ?, ?, ?)
  `).run('LHR', 'AMS', 'KL', 'KLM');

  // Carrier for LHR → CDG
  db.prepare(`
    INSERT INTO route_carriers (origin_iata, dest_iata, carrier_iata, carrier_name)
    VALUES (?, ?, ?, ?)
  `).run('LHR', 'CDG', 'BA', 'British Airways');

  return db;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('/api/airports/*', () => {
  let app;
  let fixtureDb;
  let jontyDb;

  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';

    // Build the in-memory DB before requiring any modules
    fixtureDb = buildFixtureDb();

    // Require jontyDb and immediately replace getDb with our fixture
    jontyDb = require('../models/jontyDb');
    jest.spyOn(jontyDb, 'getDb').mockReturnValue(fixtureDb);

    // Now load the app (which will eventually require jontyDb via the controller)
    app = require('../index');
  });

  afterAll(() => {
    if (fixtureDb) fixtureDb.close();
    jest.restoreAllMocks();
  });

  // ─── Test 1: full payload for known airport ────────────────────────────────

  test('GET /api/airports/LHR returns full payload', async () => {
    const r = await request(app).get('/api/airports/LHR');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);

    const { airport, routes } = r.body;
    expect(airport.iata).toBe('LHR');
    expect(airport.icao).toBe('EGLL');
    expect(airport.city).toBe('London');
    expect(airport.country_code).toBe('GB');
    expect(typeof airport.latitude).toBe('number');
    expect(typeof airport.longitude).toBe('number');

    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBe(2);

    const ams = routes.find(r => r.dest_iata === 'AMS');
    expect(ams).toBeDefined();
    expect(ams.km).toBe(371);
    expect(ams.duration_min).toBe(80);
    expect(ams.carriers.length).toBe(2);
    const iatas = ams.carriers.map(c => c.iata);
    expect(iatas).toContain('BA');
    expect(iatas).toContain('KL');
  });

  // ─── Test 2: unknown airport → 404 ────────────────────────────────────────

  test('GET /api/airports/XXX returns 404', async () => {
    const r = await request(app).get('/api/airports/XXX');
    expect(r.status).toBe(404);
    expect(r.body.success).toBe(false);
  });

  // ─── Test 3: lowercase IATA is uppercased ─────────────────────────────────

  test('GET /api/airports/lhr (lowercase) matches LHR', async () => {
    const r = await request(app).get('/api/airports/lhr');
    expect(r.status).toBe(200);
    expect(r.body.airport.iata).toBe('LHR');
  });

  // ─── Test 4: invalid IATA → 400 ───────────────────────────────────────────

  test('GET /api/airports/AB (2 chars) returns 400', async () => {
    const r = await request(app).get('/api/airports/AB');
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
    expect(r.body.message).toBe('Invalid IATA');
  });

  test('GET /api/airports/1234 (4 chars) returns 400', async () => {
    const r = await request(app).get('/api/airports/1234');
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
  });

  // ─── Test 5: country filter ────────────────────────────────────────────────

  test('GET /api/airports?country=GB returns only GB airports', async () => {
    const r = await request(app).get('/api/airports?country=GB');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.total).toBe(2);
    for (const a of r.body.airports) {
      expect(a.country_code).toBe('GB');
    }
  });

  // ─── Test 6: invalid country is ignored, full list returned ───────────────

  test('GET /api/airports?country=invalid returns full list', async () => {
    const r = await request(app).get('/api/airports?country=invalid');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    // 5 fixture airports with no filter applied
    expect(r.body.total).toBe(5);
  });

  // ─── Test 7: limit + offset pagination ────────────────────────────────────

  test('GET /api/airports?limit=2&offset=1 paginates correctly', async () => {
    const full = await request(app).get('/api/airports');
    const allIatas = full.body.airports.map(a => a.iata);

    const r = await request(app).get('/api/airports?limit=2&offset=1');
    expect(r.status).toBe(200);
    expect(r.body.limit).toBe(2);
    expect(r.body.offset).toBe(1);
    expect(r.body.airports.length).toBe(2);
    expect(r.body.total).toBe(5);

    // The page should be the 2nd and 3rd airports in sorted order
    expect(r.body.airports[0].iata).toBe(allIatas[1]);
    expect(r.body.airports[1].iata).toBe(allIatas[2]);
  });

  // ─── Test 8: 503 when jonty.db missing ────────────────────────────────────

  test('GET /api/airports when jonty.db missing returns 503', async () => {
    // Override getDb to throw the "not present" error for this test only
    jontyDb.getDb.mockImplementationOnce(() => {
      throw new Error('jonty.db not present — run server/scripts/sync-jonty.js');
    });

    const r = await request(app).get('/api/airports/LHR');
    expect(r.status).toBe(503);
    expect(r.body.success).toBe(false);
    expect(r.body.message).toBe('Airport data not available');
  });

  test('GET /api/airports list when jonty.db missing returns 503', async () => {
    jontyDb.getDb.mockImplementationOnce(() => {
      throw new Error('jonty.db not present — run server/scripts/sync-jonty.js');
    });

    const r = await request(app).get('/api/airports');
    expect(r.status).toBe(503);
    expect(r.body.success).toBe(false);
  });

  // ─── Test 9: N+1 guard — only 1 db.prepare call for getAirport ───────────
  // We verify the controller uses exactly 2 db.prepare calls (airport lookup +
  // the single routes+carriers JOIN) rather than N+1 calls.

  test('getAirport uses only 2 prepare calls (no N+1)', async () => {
    const prepareSpy = jest.spyOn(fixtureDb, 'prepare');
    prepareSpy.mockClear();

    const r = await request(app).get('/api/airports/LHR');
    expect(r.status).toBe(200);

    // Exactly 2 prepare calls: one for airport lookup, one for routes+carriers JOIN
    const callCount = prepareSpy.mock.calls.length;
    expect(callCount).toBe(2);

    prepareSpy.mockRestore();
  });
});

'use strict';

// Exercises GET /api/aircraft/routes + db.getAircraftRoutes.
// Uses the real in-memory SQLite DB (NODE_ENV=test from setup.js) and seeds
// observed_routes via the public upsert helper. Mirrors hubNetwork.test.js style.

const request      = require('supertest');
const app          = require('../index');
const db           = require('../models/db');
const cacheService = require('../services/cacheService');

// Seed a mix of A380 and A330 rows from Prague/Vienna/Frankfurt. PRG, VIE, FRA,
// LHR, JFK, DXB, DOH are all real IATAs in OpenFlights airports.dat.
beforeAll(() => {
  // A380 departures from PRG — 2 distinct destinations, LHR has 3 rows (different airlines'
  // ICAO variants don't apply — PK is (dep, arr, aircraft) so we need distinct icao codes).
  db.upsertObservedRoute({ depIata: 'PRG', arrIata: 'LHR', aircraftIcao: 'A388' });
  db.upsertObservedRoute({ depIata: 'PRG', arrIata: 'DXB', aircraftIcao: 'A388' });
  // A380 from VIE
  db.upsertObservedRoute({ depIata: 'VIE', arrIata: 'DXB', aircraftIcao: 'A388' });
  // A380 from FRA (used for suggestions test — PRG/VIE empty case)
  db.upsertObservedRoute({ depIata: 'FRA', arrIata: 'JFK', aircraftIcao: 'A388' });
  db.upsertObservedRoute({ depIata: 'FRA', arrIata: 'DXB', aircraftIcao: 'A388' });

  // Some A330 noise — must NOT leak into A380 queries.
  db.upsertObservedRoute({ depIata: 'PRG', arrIata: 'AMS', aircraftIcao: 'A333' });
  db.upsertObservedRoute({ depIata: 'VIE', arrIata: 'AMS', aircraftIcao: 'A333' });
});

afterEach(() => {
  cacheService.flush();
});

describe('GET /api/aircraft/routes — happy path', () => {
  it('returns the declared shape for a valid family + single origin', async () => {
    const res = await request(app).get('/api/aircraft/routes?family=a380&origins=PRG');
    expect(res.status).toBe(200);

    const b = res.body;
    expect(b.family).toBe('a380');
    expect(typeof b.familyName).toBe('string');
    expect(Array.isArray(b.icaoTypes)).toBe(true);
    expect(b.icaoTypes).toContain('A388'); // real ICAO type for A380-800
    expect(b.windowDays).toBe(14);

    expect(Array.isArray(b.origins)).toBe(true);
    expect(b.origins).toHaveLength(1);
    expect(b.origins[0]).toMatchObject({
      iata: 'PRG',
      name: expect.any(String),
      lat:  expect.any(Number),
      lon:  expect.any(Number),
    });

    expect(Array.isArray(b.routes)).toBe(true);
    const deps = new Set(b.routes.map(r => r.dep));
    const arrs = new Set(b.routes.map(r => r.arr));
    expect(deps.has('PRG')).toBe(true);
    expect(arrs.has('LHR')).toBe(true);
    expect(arrs.has('DXB')).toBe(true);
    // No A333 leakage.
    expect(arrs.has('AMS')).toBe(false);

    for (const r of b.routes) {
      expect(r).toMatchObject({
        dep: expect.stringMatching(/^[A-Z]{3}$/),
        arr: expect.stringMatching(/^[A-Z]{3}$/),
        icaoTypes: expect.any(Array),
        count: expect.any(Number),
      });
      expect(Number.isNaN(Date.parse(r.lastSeen))).toBe(false);
    }

    expect(b.suggestions).toEqual([]);
  });

  it('aggregates across multiple origins and sorts by count desc, dep asc, arr asc', async () => {
    const res = await request(app).get('/api/aircraft/routes?family=a380&origins=PRG,VIE');
    expect(res.status).toBe(200);
    const routes = res.body.routes;
    expect(routes.length).toBeGreaterThanOrEqual(3);

    // Sort contract: count desc, then dep asc, then arr asc.
    for (let i = 1; i < routes.length; i++) {
      const a = routes[i - 1], b = routes[i];
      if (a.count === b.count) {
        if (a.dep === b.dep) expect(a.arr <= b.arr).toBe(true);
        else                 expect(a.dep <= b.dep).toBe(true);
      } else {
        expect(a.count >= b.count).toBe(true);
      }
    }

    // Each row should appear exactly once per (dep, arr) pair.
    const pairs = routes.map(r => `${r.dep}-${r.arr}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('GET /api/aircraft/routes — error branches', () => {
  it('returns 400 for unknown family slug', async () => {
    const res = await request(app).get('/api/aircraft/routes?family=concorde&origins=PRG');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/unknown aircraft family/i);
  });

  it('rejects origin lists with more than 10 entries', async () => {
    const many = ['PRG','VIE','FRA','LHR','JFK','DXB','DOH','AMS','MUC','BUD','CDG'].join(',');
    const res = await request(app).get(`/api/aircraft/routes?family=a380&origins=${many}`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/at most 10/i);
  });

  it('returns 400 when all requested origins are unknown airports', async () => {
    const res = await request(app).get('/api/aircraft/routes?family=a380&origins=ZZZ,QQQ');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no valid origins/i);
  });
});

describe('GET /api/aircraft/routes — suggestions branch', () => {
  it('populates suggestions when routes is empty and a nearby airport has data', async () => {
    // LUX (Luxembourg) has no A380 data itself but FRA (≈175 km away) does.
    const res = await request(app).get('/api/aircraft/routes?family=a380&origins=LUX');
    expect(res.status).toBe(200);
    expect(res.body.routes).toEqual([]);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions.length).toBeGreaterThan(0);

    const iatas = res.body.suggestions.map(s => s.iata);
    expect(iatas).toContain('FRA');

    for (const s of res.body.suggestions) {
      expect(s).toMatchObject({
        iata:       expect.stringMatching(/^[A-Z]{3}$/),
        name:       expect.any(String),
        distanceKm: expect.any(Number),
        routeCount: expect.any(Number),
      });
      expect(s.routeCount).toBeGreaterThan(0);
    }
  });
});

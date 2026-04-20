'use strict';

// Exercises both the db helper (getHubNetwork) and the HTTP endpoint
// (GET /api/map/hub-network). Uses the real in-memory SQLite DB (NODE_ENV=test
// is set by setup.js) and seeds observed_routes via the public upsert helper.
//
// We pick 5 real IATAs as "hubs" (JFK, LHR, CDG, FRA, AMS) and give each 20
// unique destinations so they clear the HAVING n >= 20 filter. Cross-hub
// routes are added separately so the edge-building step has something to do.

const request = require('supertest');
const app = require('../index');
const db  = require('../models/db');
const cacheService = require('../services/cacheService');

// 5 hubs + 25 fillers — all are valid IATAs in OpenFlights airports.dat.
const HUBS = ['JFK', 'LHR', 'CDG', 'FRA', 'AMS'];
// Fillers: none of these is itself a hub in our seed (they get 0 or 1 outgoing routes).
const FILLERS = [
  'BOS', 'MIA', 'ORD', 'DFW', 'SEA', 'SFO', 'LAX', 'ATL', 'IAD', 'PHL',
  'YYZ', 'YVR', 'YUL', 'MEX', 'GRU', 'EZE', 'SCL', 'BOG', 'LIM', 'UIO',
  'DUB', 'EDI', 'MAN', 'LGW', 'STN',
];

beforeAll(() => {
  // Seed 20 unique destinations per hub so HAVING n >= 20 is met exactly.
  // aircraft_icao varies so PK (dep, arr, aircraft) stays unique.
  for (const hub of HUBS) {
    for (let i = 0; i < 20; i++) {
      db.upsertObservedRoute({
        depIata: hub,
        arrIata: FILLERS[i],
        aircraftIcao: 'B738',
        airlineIata: null,
      });
    }
  }

  // Cross-hub links. Insert each pair in BOTH directions with varying obs counts
  // (different aircraft_icao rows) so we can verify:
  //   (a) lexicographic collapse — ["AMS","JFK"] not ["JFK","AMS"]
  //   (b) ordering by observation count desc
  const crossPairs = [
    // pair, directional-row-count (more rows = more "observations")
    [['JFK', 'LHR'], 5],  // most popular
    [['CDG', 'FRA'], 3],
    [['AMS', 'JFK'], 2],
    [['LHR', 'CDG'], 1],
  ];
  const fwdAircraft = ['B738', 'A320', 'B77W', 'B789', 'A388'];
  const revAircraft = ['B744', 'A333', 'B763', 'A359', 'B772'];
  for (const [[a, b], count] of crossPairs) {
    for (let i = 0; i < count; i++) {
      db.upsertObservedRoute({
        depIata: a, arrIata: b,
        aircraftIcao: fwdAircraft[i],
        airlineIata: null,
      });
      db.upsertObservedRoute({
        depIata: b, arrIata: a,
        aircraftIcao: revAircraft[i],
        airlineIata: null,
      });
    }
  }
});

afterEach(() => {
  cacheService.flush(); // don't let cache leak between tests
});

describe('db.getHubNetwork', () => {
  it('returns hubs that meet the minDests threshold', () => {
    const { hubs } = db.getHubNetwork({ hubLimit: 200, minDests: 20, edgeLimit: 3000 });
    // All 5 seeded hubs should qualify; fillers definitely should not.
    for (const h of HUBS) expect(hubs).toContain(h);
    for (const f of FILLERS) expect(hubs).not.toContain(f);
  });

  it('honours hubLimit cap', () => {
    const { hubs } = db.getHubNetwork({ hubLimit: 3, minDests: 20, edgeLimit: 3000 });
    expect(hubs.length).toBeLessThanOrEqual(3);
    // Only hubs (never fillers) should appear.
    for (const h of hubs) expect(HUBS).toContain(h);
  });

  it('filters out airports below minDests', () => {
    const { hubs } = db.getHubNetwork({ hubLimit: 200, minDests: 100, edgeLimit: 3000 });
    // Nothing in the seed has >= 100 distinct destinations.
    expect(hubs).toEqual([]);
  });

  it('emits each edge once in lexicographic order (a < b)', () => {
    const { edges } = db.getHubNetwork({ hubLimit: 200, minDests: 20, edgeLimit: 3000 });
    expect(edges.length).toBeGreaterThan(0);

    const seen = new Set();
    for (const [a, b] of edges) {
      expect(a < b).toBe(true);        // lexicographic order
      const key = `${a}|${b}`;
      expect(seen.has(key)).toBe(false); // no dupes
      seen.add(key);
    }

    // Known pairs in our seed, in lexicographic form:
    const keys = new Set(edges.map(([a, b]) => `${a}|${b}`));
    expect(keys.has('JFK|LHR')).toBe(true);
    expect(keys.has('CDG|FRA')).toBe(true);
    expect(keys.has('AMS|JFK')).toBe(true);
    expect(keys.has('CDG|LHR')).toBe(true);
    // Never the reversed form
    expect(keys.has('LHR|JFK')).toBe(false);
  });

  it('orders edges by observation count desc — top edges are the most-seen pairs', () => {
    const { edges } = db.getHubNetwork({ hubLimit: 200, minDests: 20, edgeLimit: 3000 });
    // JFK|LHR had 5 rows/direction (10 total), the highest, so it should lead.
    expect(edges[0]).toEqual(['JFK', 'LHR']);
  });

  it('caps the edge list at edgeLimit', () => {
    const { edges } = db.getHubNetwork({ hubLimit: 200, minDests: 20, edgeLimit: 2 });
    expect(edges.length).toBeLessThanOrEqual(2);
  });
});

describe('GET /api/map/hub-network', () => {
  it('responds 200 with {edges, count, generatedAt} and consistent count', async () => {
    const res = await request(app).get('/api/map/hub-network');
    expect(res.status).toBe(200);

    const body = res.body;
    expect(Array.isArray(body.edges)).toBe(true);
    expect(typeof body.count).toBe('number');
    expect(typeof body.generatedAt).toBe('string');
    expect(body.count).toBe(body.edges.length);
    // ISO 8601 parseable
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);

    // No extra top-level fields beyond the contract.
    expect(Object.keys(body).sort()).toEqual(['count', 'edges', 'generatedAt']);
  });

  it('every edge is a [IATA, IATA] tuple, 3-letter uppercase', async () => {
    const res = await request(app).get('/api/map/hub-network');
    expect(res.status).toBe(200);
    for (const edge of res.body.edges) {
      expect(Array.isArray(edge)).toBe(true);
      expect(edge).toHaveLength(2);
      const [a, b] = edge;
      expect(typeof a).toBe('string');
      expect(typeof b).toBe('string');
      expect(a).toMatch(/^[A-Z]{3}$/);
      expect(b).toMatch(/^[A-Z]{3}$/);
      expect(a).not.toBe(b);
      expect(a < b).toBe(true); // lexicographic
    }
  });

  it('serves the cached payload on the second request', async () => {
    const r1 = await request(app).get('/api/map/hub-network');
    const r2 = await request(app).get('/api/map/hub-network');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // generatedAt is computed once at build-time, so a cache hit returns the same string.
    expect(r2.body.generatedAt).toBe(r1.body.generatedAt);
  });
});

'use strict';

/**
 * Tests for routeService — real SQLite DB (better-sqlite3), mocked openFlightsService.
 *
 * CRITICAL: observed_routes.airline_iata stores ICAO codes ('BAW' not 'BA').
 * All insertions here use ICAO codes in the airline_iata column.
 * Lookup for display uses openFlightsService.getAirlineByIcao().
 */

// Mock openFlightsService to avoid loading airports.dat on test boot.
jest.mock('../services/openFlightsService', () => ({
  getAirport:       jest.fn(),
  getAirline:       jest.fn(),
  getAirlineByIcao: jest.fn(),
  isValidAirport:   jest.fn(() => true),
  getCity:          jest.fn((iata) => iata),
  getCountry:       jest.fn(() => null),
  getAllAirports:    jest.fn(() => []),
  getAirportByIcao: jest.fn(() => null),
  iataForIcao:      jest.fn(() => null),
}));

const { db }                = require('../models/db');
const {
  getRouteData,
  listValidRoutePairs,
  getTopRoutesFromCity,
  getTopRoutesToCity,
  _resetCaches,
}                           = require('../services/routeService');
const openFlightsService    = require('../services/openFlightsService');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SOURCE = 'test-route-service';
const now    = Date.now();
const day    = 24 * 60 * 60 * 1000;

// Airport stubs with full coords (realistic lat/lon).
const AIRPORTS = {
  LHR: { iata: 'LHR', lat: 51.477,  lon: -0.461,   city: 'London',    country: 'GB' },
  JFK: { iata: 'JFK', lat: 40.641,  lon: -73.778,  city: 'New York',  country: 'US' },
  LAX: { iata: 'LAX', lat: 33.943,  lon: -118.408, city: 'Los Angeles', country: 'US' },
  CDG: { iata: 'CDG', lat: 49.013,  lon: 2.550,    city: 'Paris',     country: 'FR' },
  AMS: { iata: 'AMS', lat: 52.308,  lon: 4.764,    city: 'Amsterdam', country: 'NL' },
  FRA: { iata: 'FRA', lat: 50.033,  lon: 8.571,    city: 'Frankfurt', country: 'DE' },
};

// Airline stubs — ICAO key (as stored in airline_iata column).
const AIRLINES = {
  BAW: { iata: 'BA', icao: 'BAW', name: 'British Airways',    country: 'GB' },
  AFR: { iata: 'AF', icao: 'AFR', name: 'Air France',         country: 'FR' },
  DLH: { iata: 'LH', icao: 'DLH', name: 'Lufthansa',          country: 'DE' },
  KLM: { iata: 'KL', icao: 'KLM', name: 'KLM',                country: 'NL' },
};

/**
 * Insert one row into observed_routes.
 * airlineIcao is the ICAO code stored in airline_iata column.
 */
function insertRow(dep, arr, aircraft, airlineIcao, seenAt = now - day) {
  db.prepare(`
    INSERT OR REPLACE INTO observed_routes
      (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(dep, arr, aircraft, airlineIcao, seenAt, seenAt - day, SOURCE);
}

beforeEach(() => {
  db.exec(`DELETE FROM observed_routes WHERE source = '${SOURCE}'`);
  jest.clearAllMocks();
  _resetCaches();
});

afterAll(() => {
  db.exec(`DELETE FROM observed_routes WHERE source = '${SOURCE}'`);
});

// ── Default mock setup helpers ────────────────────────────────────────────────

function mockAirports(codes = Object.keys(AIRPORTS)) {
  openFlightsService.getAirport.mockImplementation((iata) =>
    AIRPORTS[iata?.toUpperCase()] || null,
  );
}

function mockAirlinesByIcao(icaos = Object.keys(AIRLINES)) {
  openFlightsService.getAirlineByIcao.mockImplementation((icao) =>
    AIRLINES[icao?.toUpperCase()] || null,
  );
}

// ── Test 1: getRouteData — valid pair returns full payload ────────────────────
//
// Insert 8 rows: 4 distinct operators × 2 distinct aircraft → meets ≥3 ops AND ≥2 aircraft.
// PK is (dep_iata, arr_iata, aircraft_icao) — no airline in the PK.
// To have 4 operators with 2 aircraft types, use unique aircraft codes so each
// INSERT uses a distinct PK. airline_iata is just an attribute on the row.
test('getRouteData: valid pair (4 ops × 2 aircraft) returns full payload', () => {
  // Each row has a unique aircraft_icao → unique PK → distinct DB row.
  // 4 different operators on LHR→JFK across 4 different aircraft types.
  // This yields 4 distinct operators and 4 distinct aircraft after aggregation.
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day); // BAW / A388
  insertRow('LHR', 'JFK', 'A359', 'AFR', now - 2 * day); // AFR / A359
  insertRow('LHR', 'JFK', 'B77W', 'DLH', now - 3 * day); // DLH / B77W
  insertRow('LHR', 'JFK', 'B789', 'KLM', now - 4 * day); // KLM / B789
  // Extra rows for the same operators with cross-aircraft — boosts obs_counts
  // and creates cross-operator/aircraft relationships.
  insertRow('LHR', 'JFK', 'B764', 'BAW', now - 5 * day); // BAW / B764 (unique PK)
  insertRow('LHR', 'JFK', 'A321', 'AFR', now - 6 * day); // AFR / A321 (unique PK)
  insertRow('LHR', 'JFK', 'B738', 'DLH', now - 7 * day); // DLH / B738 (unique PK)
  insertRow('LHR', 'JFK', 'A320', 'KLM', now - 8 * day); // KLM / A320 (unique PK)

  mockAirports();
  mockAirlinesByIcao();

  const result = getRouteData({ from: 'LHR', to: 'JFK', sinceMs: now - 90 * day });

  expect(result).not.toBeNull();

  // Dep/arr shape.
  expect(result.dep.iata).toBe('LHR');
  expect(result.dep.city).toBe('London');
  expect(result.arr.iata).toBe('JFK');
  expect(result.arr.city).toBe('New York');

  // Distance and time fields.
  expect(typeof result.distance_km).toBe('number');
  expect(result.distance_km).toBeGreaterThan(0);
  expect(typeof result.estimated_hours).toBe('number');
  expect(result.estimated_hours).toBeGreaterThan(0);
  expect(typeof result.estimated_time_str).toBe('string');
  expect(result.estimated_time_str).toMatch(/^\d+h \d+m$/);

  // Operators array — 4 distinct airlines, sorted by obs_count DESC.
  expect(result.operators.length).toBe(4);
  for (const op of result.operators) {
    expect(op).toHaveProperty('iata');
    expect(op).toHaveProperty('icao');
    expect(op).toHaveProperty('name');
    expect(op).toHaveProperty('aircraft_count');
    expect(op).toHaveProperty('obs_count');
  }
  // Sorted desc by obs_count.
  for (let i = 1; i < result.operators.length; i++) {
    expect(result.operators[i - 1].obs_count).toBeGreaterThanOrEqual(result.operators[i].obs_count);
  }

  // Aircraft array — 8 distinct aircraft types (one per row = one per unique PK).
  expect(result.aircraft.length).toBe(8);
  for (const ac of result.aircraft) {
    expect(ac).toHaveProperty('icao');
    expect(ac).toHaveProperty('name');
    expect(ac).toHaveProperty('operator_count');
    expect(ac).toHaveProperty('obs_count');
  }

  // Summary.
  expect(result.summary.total_observations).toBe(8);
  expect(result.summary.distinct_operators).toBe(4);
  expect(result.summary.distinct_aircraft).toBe(8);
});

// ── Test 2: getRouteData — thin pair returns null ─────────────────────────────
//
// 1 operator + 1 aircraft → fails both sides of the OR threshold.
test('getRouteData: thin pair (1 op, 1 aircraft) returns null', () => {
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);

  mockAirports();
  mockAirlinesByIcao();

  const result = getRouteData({ from: 'LHR', to: 'JFK', sinceMs: now - 90 * day });

  expect(result).toBeNull();
});

// ── Test 3: getRouteData — unknown airport returns null ───────────────────────
//
// Either dep or arr resolves to null → bail out before touching the DB.
test('getRouteData: unknown departure airport returns null', () => {
  // No rows needed — the service bails before the SQL query.
  openFlightsService.getAirport.mockReturnValue(null);

  const result = getRouteData({ from: 'ZZZ', to: 'JFK', sinceMs: now - 90 * day });
  expect(result).toBeNull();
});

test('getRouteData: unknown arrival airport returns null', () => {
  openFlightsService.getAirport.mockImplementation((iata) =>
    iata === 'LHR' ? AIRPORTS.LHR : null,
  );

  const result = getRouteData({ from: 'LHR', to: 'ZZZ', sinceMs: now - 90 * day });
  expect(result).toBeNull();
});

// ── Test 4: getRouteData — lowercase input works ──────────────────────────────
test('getRouteData: lowercase from/to are normalised to uppercase', () => {
  // 4 distinct operators, each on a unique aircraft_icao (unique PKs).
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'JFK', 'A359', 'AFR', now - 2 * day);
  insertRow('LHR', 'JFK', 'B77W', 'DLH', now - 3 * day);
  insertRow('LHR', 'JFK', 'B789', 'KLM', now - 4 * day);

  mockAirports();
  mockAirlinesByIcao();

  // Pass lowercase — must work identically.
  const result = getRouteData({ from: 'lhr', to: 'jfk', sinceMs: now - 90 * day });

  expect(result).not.toBeNull();
  expect(result.dep.iata).toBe('LHR');
  expect(result.arr.iata).toBe('JFK');
  expect(result.summary.distinct_operators).toBe(4);
});

// ── Test 5: getRouteData — distance and time computation (LHR→JFK) ────────────
//
// LHR (51.477, -0.461) → JFK (40.641, -73.778) ≈ 5550 km ±100.
// estimated_hours ≈ (5550/850) + 0.33 ≈ 6.86.
test('getRouteData: LHR→JFK distance ≈ 5550 km ±100, time ≈ 6.8h', () => {
  // Need ≥3 ops OR ≥2 aircraft to pass threshold.
  // Use distinct aircraft_icao per row so PKs don't collide.
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'JFK', 'A359', 'AFR', now - 2 * day);
  insertRow('LHR', 'JFK', 'B77W', 'DLH', now - 3 * day);

  mockAirports();
  mockAirlinesByIcao();

  const result = getRouteData({ from: 'LHR', to: 'JFK', sinceMs: now - 90 * day });

  expect(result).not.toBeNull();
  expect(result.distance_km).toBeGreaterThan(5450);
  expect(result.distance_km).toBeLessThan(5650);

  // estimated_hours = (dist/850) + 0.33
  const expectedHours = (result.distance_km / 850) + 0.33;
  expect(result.estimated_hours).toBeCloseTo(expectedHours, 1);

  // Time string should reflect ~6h something.
  expect(result.estimated_time_str).toMatch(/^6h/);
});

// ── Test 6: listValidRoutePairs — threshold filtering ────────────────────────
//
// Insert 3 pairs: one thin (1 op, 1 ac), one meeting ops threshold (3 ops),
// one meeting aircraft threshold (2 ac). listValidRoutePairs must return only
// the 2 qualifying pairs.
//
// PK is (dep_iata, arr_iata, aircraft_icao). To get 3 distinct operators on
// LHR→CDG we need 3 distinct aircraft_icao values (each operator flies a
// different type on that route).
test('listValidRoutePairs: returns pairs meeting ≥3 ops OR ≥2 aircraft threshold; excludes thin pairs', () => {
  // Thin pair LHR→LAX: 1 op, 1 aircraft — excluded.
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 1 * day);

  // Meets ops threshold (3 distinct ops) LHR→CDG.
  // Each operator flies a unique aircraft_icao → 3 distinct PKs → 3 distinct airlines.
  insertRow('LHR', 'CDG', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'CDG', 'A359', 'AFR', now - 2 * day);
  insertRow('LHR', 'CDG', 'B77W', 'DLH', now - 3 * day);

  // Meets aircraft threshold (2 distinct ac) LHR→AMS.
  insertRow('LHR', 'AMS', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'AMS', 'B77W', 'BAW', now - 2 * day);

  const pairs = listValidRoutePairs({ sinceMs: now - 90 * day, minOperators: 3, minAircraft: 2 });

  // Must not include the thin pair.
  const keys = pairs.map(p => `${p.from}-${p.to}`);
  expect(keys).not.toContain('LHR-LAX');

  // Must include the two qualifying pairs.
  expect(keys).toContain('LHR-CDG');
  expect(keys).toContain('LHR-AMS');

  // Shape check.
  for (const p of pairs) {
    expect(p).toHaveProperty('from');
    expect(p).toHaveProperty('to');
    expect(p).toHaveProperty('op_count');
    expect(p).toHaveProperty('ac_count');
  }
});

// ── Test 7: getTopRoutesFromCity — top arr by count, excludes current pair ────
test('getTopRoutesFromCity: returns top arr airports by count, excludes current pair', () => {
  // LHR→JFK: 3 rows (highest count). Use distinct aircraft_icao for unique PKs.
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'JFK', 'A359', 'AFR', now - 2 * day);
  insertRow('LHR', 'JFK', 'B77W', 'DLH', now - 3 * day);

  // LHR→CDG: 2 rows.
  insertRow('LHR', 'CDG', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'CDG', 'A359', 'AFR', now - 2 * day);

  // LHR→AMS: 1 row — this is our "current pair" to exclude.
  insertRow('LHR', 'AMS', 'A388', 'BAW', now - 1 * day);

  mockAirports();
  mockAirlinesByIcao();

  const result = getTopRoutesFromCity({
    iata:        'LHR',
    sinceMs:     now - 90 * day,
    limit:       5,
    excludePair: 'LHR-AMS',
  });

  // AMS must be excluded (it's the current pair).
  const arrs = result.map(r => r.arr_iata);
  expect(arrs).not.toContain('AMS');

  // JFK and CDG must be present in count-desc order.
  expect(arrs[0]).toBe('JFK');
  expect(result[0].count).toBe(3);
  expect(arrs[1]).toBe('CDG');
  expect(result[1].count).toBe(2);

  // Shape check.
  for (const r of result) {
    expect(r).toHaveProperty('arr_iata');
    expect(r).toHaveProperty('arr_city');
    expect(r).toHaveProperty('arr_country');
    expect(r).toHaveProperty('count');
  }
});

// ── Test 8: Cache — 2 calls with same args → 1 SQL execution ─────────────────
//
// Spy on db.prepare to count actual SQL executions. The second call with
// identical args must be served from the in-process cache (0 additional SQL).
test('getRouteData: second call with same args hits cache (single SQL execution)', () => {
  // Insert a valid pair (≥3 ops, using distinct aircraft_icao for unique PKs).
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'JFK', 'A359', 'AFR', now - 2 * day);
  insertRow('LHR', 'JFK', 'B77W', 'DLH', now - 3 * day);

  mockAirports();
  mockAirlinesByIcao();

  // Count executions of the observed_routes SELECT for this pair.
  let sqlCallCount = 0;
  const originalPrepare = db.prepare.bind(db);

  const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql) => {
    const stmt = originalPrepare(sql);
    // Target only the pair-data query (has both dep_iata and arr_iata filters).
    if (sql.includes('UPPER(dep_iata)') && sql.includes('UPPER(arr_iata)')) {
      const originalAll = stmt.all.bind(stmt);
      stmt.all = (...args) => {
        sqlCallCount++;
        return originalAll(...args);
      };
    }
    return stmt;
  });

  // Use a bucketed sinceMs so both calls map to the same cache key.
  const sinceMs = Math.floor((now - 90 * day) / 60_000) * 60_000;

  getRouteData({ from: 'LHR', to: 'JFK', sinceMs });
  getRouteData({ from: 'LHR', to: 'JFK', sinceMs });

  expect(sqlCallCount).toBe(1);

  prepareSpy.mockRestore();
});

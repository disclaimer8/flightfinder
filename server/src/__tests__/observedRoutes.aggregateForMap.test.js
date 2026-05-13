'use strict';

// Mock openFlightsService so we don't load 7K-row airports.dat on test boot.
// Each test that needs airport lookups configures the mock implementation.
jest.mock('../services/openFlightsService', () => ({
  getAirport: jest.fn(),
  getAirline: jest.fn(),
  getAirlineByIcao: jest.fn(),
  isValidAirport: jest.fn(() => true),
  getCity: jest.fn((iata) => iata),
  getCountry: jest.fn(() => null),
  getAllAirports: jest.fn(() => []),
  getAirportByIcao: jest.fn(() => null),
  iataForIcao: jest.fn(() => null),
}));

const { db } = require('../models/db');
const { aggregateForMap } = require('../models/observedRoutes');
const openFlightsService = require('../services/openFlightsService');

// Stable airport stubs used by most tests
const AIRPORTS = {
  LHR: { iata: 'LHR', lat: 51.477, lon: -0.461, name: 'London Heathrow', city: 'London', country: 'GB' },
  JFK: { iata: 'JFK', lat: 40.641, lon: -73.778, name: 'JFK', city: 'New York', country: 'US' },
  CDG: { iata: 'CDG', lat: 49.009, lon: 2.547, name: 'Charles de Gaulle', city: 'Paris', country: 'FR' },
};

const SOURCE = 'test-aggregate-map';
const now = Date.now();
const day = 24 * 60 * 60 * 1000;

function insertRow(dep, arr, aircraft, airline, seenAt = now - day) {
  db.prepare(`
    INSERT OR REPLACE INTO observed_routes
      (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(dep, arr, aircraft, airline, seenAt, seenAt - day, SOURCE);
}

beforeEach(() => {
  db.exec(`DELETE FROM observed_routes WHERE source = '${SOURCE}'`);
  jest.clearAllMocks();
  // Default: all AIRPORTS stubs resolve correctly
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);
});

afterAll(() => {
  db.exec(`DELETE FROM observed_routes WHERE source = '${SOURCE}'`);
});

// ── Test 1: No filters — 6 rows, 3 distinct pairs ────────────────────────────
//
// NOTE: observed_routes PK is (dep_iata, arr_iata, aircraft_icao), so two rows
// that differ only by airline on the same (dep,arr,aircraft) would collapse to
// one. To get 2 distinct airlines per pair we use 2 distinct aircraft types per
// airline, ensuring unique PK tuples.
test('no filters: 6 rows across 3 pairs returns 3 routes with correct counts', () => {
  // Pair 1: LHR→JFK — 2 airlines (BA, AA), 2 aircraft (B789, A320) — unique PKs
  insertRow('LHR', 'JFK', 'B789', 'BA', now - 1 * day);
  insertRow('LHR', 'JFK', 'A320', 'AA', now - 2 * day);
  // Pair 2: LHR→CDG — 2 airlines (BA, VS), 2 aircraft (A320, B789) — unique PKs
  insertRow('LHR', 'CDG', 'A320', 'BA', now - 1 * day);
  insertRow('LHR', 'CDG', 'B789', 'VS', now - 3 * day);
  // Pair 3: JFK→CDG — 1 airline (AA), 2 aircraft (B788, B789) — unique PKs
  insertRow('JFK', 'CDG', 'B788', 'AA', now - 4 * day);
  insertRow('JFK', 'CDG', 'B789', 'AA', now - 2 * day);

  const routes = aggregateForMap({});

  expect(routes).toHaveLength(3);

  const lhrJfk = routes.find(r => r.dep_iata === 'LHR' && r.arr_iata === 'JFK');
  expect(lhrJfk).toBeDefined();
  expect(lhrJfk.airline_count).toBe(2);   // BA + AA
  expect(lhrJfk.aircraft_count).toBe(2);  // B789 + A320
  expect(lhrJfk.last_seen_at).toBe(now - 1 * day);

  const lhrCdg = routes.find(r => r.dep_iata === 'LHR' && r.arr_iata === 'CDG');
  expect(lhrCdg).toBeDefined();
  expect(lhrCdg.airline_count).toBe(2);   // BA + VS
  expect(lhrCdg.aircraft_count).toBe(2);  // A320 + B789
  expect(lhrCdg.last_seen_at).toBe(now - 1 * day);

  const jfkCdg = routes.find(r => r.dep_iata === 'JFK' && r.arr_iata === 'CDG');
  expect(jfkCdg).toBeDefined();
  expect(jfkCdg.airline_count).toBe(1);   // AA only
  expect(jfkCdg.aircraft_count).toBe(2);  // B788 + B789
  expect(jfkCdg.last_seen_at).toBe(now - 2 * day);

  // Verify coords are passed through
  expect(lhrJfk.dep_lat).toBe(AIRPORTS.LHR.lat);
  expect(lhrJfk.arr_lon).toBe(AIRPORTS.JFK.lon);
});

// ── Test 2: Airline filter — only matching rows aggregate ────────────────────
test('airline filter restricts aggregation; lowercase input works', () => {
  // 2 rows for BA, 1 for AA — on different pairs
  insertRow('LHR', 'JFK', 'B789', 'BA', now - 1 * day);
  insertRow('LHR', 'CDG', 'A320', 'BA', now - 2 * day);
  insertRow('JFK', 'CDG', 'B788', 'AA', now - 1 * day);

  // Filter by lowercase 'ba' — should normalize to 'BA'
  const routes = aggregateForMap({ airline: 'ba' });

  expect(routes).toHaveLength(2);
  const iatas = routes.map(r => `${r.dep_iata}-${r.arr_iata}`).sort();
  expect(iatas).toEqual(['LHR-CDG', 'LHR-JFK']);

  // AA's JFK→CDG row must NOT appear
  expect(routes.find(r => r.dep_iata === 'JFK' && r.arr_iata === 'CDG')).toBeUndefined();
});

// ── Test 3: Aircraft filter — only matching rows aggregate ───────────────────
test('aircraft filter restricts aggregation; lowercase input works', () => {
  // A320 on LHR→JFK and JFK→CDG; B789 on LHR→CDG
  insertRow('LHR', 'JFK', 'A320', 'BA', now - 1 * day);
  insertRow('JFK', 'CDG', 'A320', 'VS', now - 1 * day);
  insertRow('LHR', 'CDG', 'B789', 'AA', now - 1 * day);

  // Filter by lowercase 'a320'
  const routes = aggregateForMap({ aircraft: 'a320' });

  expect(routes).toHaveLength(2);
  const iatas = routes.map(r => `${r.dep_iata}-${r.arr_iata}`).sort();
  expect(iatas).toEqual(['JFK-CDG', 'LHR-JFK']);

  // B789 row (LHR→CDG) must NOT appear
  expect(routes.find(r => r.dep_iata === 'LHR' && r.arr_iata === 'CDG')).toBeUndefined();
});

// ── Test 4: Coord-miss drop ──────────────────────────────────────────────────
test('pairs with unknown airport coords are dropped; valid pair is returned', () => {
  // 2 rows with valid IATAs
  insertRow('LHR', 'JFK', 'B789', 'BA', now - 1 * day);
  // 2 rows where dep_iata='XXX' is unknown
  insertRow('XXX', 'JFK', 'A320', 'BA', now - 1 * day);
  insertRow('XXX', 'CDG', 'B788', 'VS', now - 2 * day);
  // Also a row where arr_iata='XXX' is unknown
  insertRow('LHR', 'XXX', 'A320', 'AA', now - 1 * day);

  // Configure mock: XXX returns null, known airports resolve normally
  openFlightsService.getAirport.mockImplementation((iata) => {
    if (!iata || iata.toUpperCase() === 'XXX') return null;
    return AIRPORTS[iata.toUpperCase()] || null;
  });

  const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

  const routes = aggregateForMap({});

  // Only LHR→JFK should survive
  expect(routes).toHaveLength(1);
  expect(routes[0].dep_iata).toBe('LHR');
  expect(routes[0].arr_iata).toBe('JFK');

  // console.info should have been called (dropped 3 pairs)
  expect(infoSpy).toHaveBeenCalledTimes(1);
  expect(infoSpy.mock.calls[0][0]).toMatch(/dropped 3 pair/);

  infoSpy.mockRestore();
});

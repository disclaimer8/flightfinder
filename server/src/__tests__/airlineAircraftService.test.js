'use strict';

/**
 * Tests for airlineAircraftService — real SQLite DB (better-sqlite3), mocked openFlightsService.
 *
 * CRITICAL: observed_routes.airline_iata stores ICAO codes ('BAW' not 'BA').
 * The service accepts IATA input ('BA'), converts to ICAO via getAirline().icao,
 * then filters the DB. All insertions here use ICAO in the airline_iata column.
 */

// Mock openFlightsService to avoid loading airports.dat on test boot.
jest.mock('../services/openFlightsService', () => ({
  getAirport:        jest.fn(),
  getAirline:        jest.fn(),
  getAirlineByIcao:  jest.fn(),
  isValidAirport:    jest.fn(() => true),
  getCity:           jest.fn((iata) => iata),
  getCountry:        jest.fn(() => null),
  getAllAirports:     jest.fn(() => []),
  getAirportByIcao:  jest.fn(() => null),
  iataForIcao:       jest.fn(() => null),
}));

const { db }                   = require('../models/db');
const {
  getCombo,
  listValidCombinations,
  getTopAircraftForAirline,
  getTopHubsForAirline,
  getTopDestinationsForAirline,
  buildValidComboSet,
  _resetValidCombosCache,
} = require('../services/airlineAircraftService');
const openFlightsService        = require('../services/openFlightsService');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SOURCE = 'test-airline-aircraft';
const now    = Date.now();
const day    = 24 * 60 * 60 * 1000;

// Airport stubs with full coords.
const AIRPORTS = {
  LHR: { iata: 'LHR', lat: 51.477,  lon: -0.461,   name: 'London Heathrow',  city: 'London',    country: 'GB' },
  JFK: { iata: 'JFK', lat: 40.641,  lon: -73.778,  name: 'JFK International', city: 'New York',  country: 'US' },
  LAX: { iata: 'LAX', lat: 33.943,  lon: -118.408, name: 'Los Angeles Intl',  city: 'Los Angeles', country: 'US' },
  SIN: { iata: 'SIN', lat: 1.364,   lon: 103.991,  name: 'Singapore Changi',  city: 'Singapore', country: 'SG' },
  SYD: { iata: 'SYD', lat: -33.946, lon: 151.177,  name: 'Sydney Airport',    city: 'Sydney',    country: 'AU' },
};

// BA airline stub (returned by getAirline('BA')).
const BA_AIRLINE = { iata: 'BA', icao: 'BAW', name: 'British Airways', country: 'GB' };

/**
 * Insert one row into observed_routes.
 * airline param = ICAO code (as stored in airline_iata column).
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
  _resetValidCombosCache();
});

afterAll(() => {
  db.exec(`DELETE FROM observed_routes WHERE source = '${SOURCE}'`);
});

// ── Test 1: Valid combo ───────────────────────────────────────────────────────
//
// 8 rows for BAW / A388 across 5 distinct (dep, arr) pairs.
// Expects: routes.length === 5, summary.n_pairs === 5, longest.distance_km > 0.
test('valid combo: 8 rows / 5 pairs returns full data object', () => {
  // 5 distinct pairs — one pair has 2 rows (same aircraft, still collapses to 1 pair via GROUP BY)
  // PK is (dep, arr, aircraft_icao) so we need different aircraft for duplicate (dep,arr) to have >1 row.
  // However the SQL groups by (dep_iata, arr_iata) regardless of aircraft, so we can
  // use same aircraft if different airports. Let's use 8 rows across 5 pairs cleanly:
  // pairs: LHR→JFK, LHR→LAX, LHR→SIN, LHR→SYD, JFK→LAX
  // 3 extra rows: duplicate (dep,arr) but different aircraft (different PK) — grouped away.
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'JFK', 'B772', 'BAW', now - 2 * day); // same pair, different aircraft — collapses to 1
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 3 * day);
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 4 * day);
  insertRow('LHR', 'SYD', 'A388', 'BAW', now - 5 * day);
  insertRow('LHR', 'SYD', 'B777', 'BAW', now - 6 * day); // same pair, different aircraft — collapses
  insertRow('JFK', 'LAX', 'A388', 'BAW', now - 7 * day);
  insertRow('JFK', 'LAX', 'B763', 'BAW', now - 8 * day); // same pair, different aircraft — collapses

  // Mock airline lookup (BA → BAW).
  openFlightsService.getAirline.mockImplementation((iata) => {
    if (iata === 'BA') return BA_AIRLINE;
    return null;
  });

  // Mock airport coord lookup.
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);

  const result = getCombo({
    iataAirline:  'BA',
    icaoAircraft: 'A388',
    sinceMs:       now - 90 * day,
  });

  expect(result).not.toBeNull();
  expect(result.routes).toHaveLength(5);
  expect(result.summary.n_pairs).toBe(5);
  expect(result.summary.n_airports).toBeGreaterThan(0);
  expect(result.summary.longest).not.toBeNull();
  expect(result.summary.longest.distance_km).toBeGreaterThan(0);
  expect(result.summary.shortest).not.toBeNull();
  expect(result.airline.iata).toBe('BA');
  expect(result.airline.icao).toBe('BAW');
  expect(result.aircraft.icao).toBe('A388');
  // slug must be populated (A388 resolves to a known family with a display name)
  expect(typeof result.aircraft.slug).toBe('string');
  expect(result.aircraft.slug.length).toBeGreaterThan(0);
});

// ── Test 2: Below threshold (3 pairs only) → null ────────────────────────────
test('below threshold: 3 pairs → null', () => {
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 2 * day);
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 3 * day);
  // Only 3 distinct pairs.

  openFlightsService.getAirline.mockImplementation((iata) => (iata === 'BA' ? BA_AIRLINE : null));
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);

  const result = getCombo({ iataAirline: 'BA', icaoAircraft: 'A388', sinceMs: now - 90 * day });

  expect(result).toBeNull();
});

// ── Test 3: Unresolvable airline → null ──────────────────────────────────────
test('unresolvable airline: getAirline returns null → null', () => {
  // Insert rows just in case service tries the DB.
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 2 * day);
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 3 * day);
  insertRow('LHR', 'SYD', 'A388', 'BAW', now - 4 * day);
  insertRow('JFK', 'LAX', 'A388', 'BAW', now - 5 * day);

  // Airline lookup fails for any input.
  openFlightsService.getAirline.mockReturnValue(null);
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);

  const result = getCombo({ iataAirline: 'XX', icaoAircraft: 'A388', sinceMs: now - 90 * day });

  expect(result).toBeNull();
});

// ── Test 4: Coord-miss drop reduces below threshold → null ───────────────────
//
// 5 pairs inserted; 2 have missing coords → after drop only 3 pairs survive → null.
test('coord-miss drop: 5 pairs - 2 missing coords = 3 survivors → null', () => {
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day); // valid
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 2 * day); // valid
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 3 * day); // valid
  insertRow('LHR', 'XXX', 'A388', 'BAW', now - 4 * day); // XXX missing coords → dropped
  insertRow('YYY', 'JFK', 'A388', 'BAW', now - 5 * day); // YYY missing coords → dropped

  openFlightsService.getAirline.mockImplementation((iata) => (iata === 'BA' ? BA_AIRLINE : null));
  openFlightsService.getAirport.mockImplementation((iata) => {
    const key = iata?.toUpperCase();
    if (key === 'XXX' || key === 'YYY') return null; // missing coords
    return AIRPORTS[key] || null;
  });

  const result = getCombo({ iataAirline: 'BA', icaoAircraft: 'A388', sinceMs: now - 90 * day });

  // 3 survivors (LHR→JFK, LHR→LAX, LHR→SIN) < 5 threshold → null
  expect(result).toBeNull();
});

// ── Test 5: listValidCombinations ────────────────────────────────────────────
//
// Insert combos at 3 / 5 / 10 pairs for one airline (BAW → BA).
// With minPairs: 5, expect 2 entries (the 5-pair and 10-pair ones).
test('listValidCombinations: returns combos >= minPairs, filtered by resolvable airline', () => {
  const AIRCRAFT_3  = 'B789'; // 3 pairs — excluded at minPairs:5
  const AIRCRAFT_5  = 'A320'; // 5 pairs — included
  const AIRCRAFT_10 = 'B77W'; // 10 pairs — included

  const airports3  = [['LHR', 'JFK'], ['LHR', 'LAX'], ['LHR', 'SIN']];
  const airports5  = [['LHR', 'JFK'], ['LHR', 'LAX'], ['LHR', 'SIN'], ['LHR', 'SYD'], ['JFK', 'LAX']];
  // 10 unique (dep,arr) pairs — reuse airports with more combos
  const airports10 = [
    ['LHR', 'JFK'], ['LHR', 'LAX'], ['LHR', 'SIN'], ['LHR', 'SYD'], ['JFK', 'LAX'],
    ['JFK', 'SIN'], ['JFK', 'SYD'], ['LAX', 'SIN'], ['LAX', 'SYD'], ['SIN', 'SYD'],
  ];

  for (const [dep, arr] of airports3) {
    insertRow(dep, arr, AIRCRAFT_3, 'BAW', now - 1 * day);
  }
  for (const [dep, arr] of airports5) {
    insertRow(dep, arr, AIRCRAFT_5, 'BAW', now - 1 * day);
  }
  for (const [dep, arr] of airports10) {
    insertRow(dep, arr, AIRCRAFT_10, 'BAW', now - 1 * day);
  }

  // Mock getAirlineByIcao: BAW → BA record.
  openFlightsService.getAirlineByIcao.mockImplementation((icao) => {
    if (icao?.toUpperCase() === 'BAW') return BA_AIRLINE;
    return null;
  });

  const combos = listValidCombinations({ sinceMs: now - 90 * day, minPairs: 5 });

  // Should return exactly 2 entries (A320 and B77W, not B789)
  expect(combos).toHaveLength(2);

  const icaos = combos.map(c => c.icao_aircraft).sort();
  expect(icaos).toEqual(['A320', 'B77W']);

  for (const c of combos) {
    expect(c.iata).toBe('BA');
    expect(c.n_pairs).toBeGreaterThanOrEqual(5);
  }

  // B789 (3 pairs) must be absent.
  expect(combos.find(c => c.icao_aircraft === 'B789')).toBeUndefined();
});

// ── Test 6: getCombo lowercase input ─────────────────────────────────────────
//
// Same fixture as Test 1. Pass iataAirline:'ba', icaoAircraft:'a388' (lowercase).
// Expects: routes.length === 5 — verifies case-insensitivity.
test('getCombo: lowercase iataAirline and icaoAircraft are normalised correctly', () => {
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'JFK', 'B772', 'BAW', now - 2 * day);
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 3 * day);
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 4 * day);
  insertRow('LHR', 'SYD', 'A388', 'BAW', now - 5 * day);
  insertRow('LHR', 'SYD', 'B777', 'BAW', now - 6 * day);
  insertRow('JFK', 'LAX', 'A388', 'BAW', now - 7 * day);
  insertRow('JFK', 'LAX', 'B763', 'BAW', now - 8 * day);

  openFlightsService.getAirline.mockImplementation((iata) => {
    if (iata === 'BA') return BA_AIRLINE;
    return null;
  });
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);

  const result = getCombo({
    iataAirline:  'ba',
    icaoAircraft: 'a388',
    sinceMs:       now - 90 * day,
  });

  expect(result).not.toBeNull();
  expect(result.routes).toHaveLength(5);
});

// ── Test 7: getCombo default sinceMs ─────────────────────────────────────────
//
// Insert BAW/A388 fixture with seen_at values within the last 30 days.
// Call getCombo without sinceMs — default must be 90 days ago (not NaN).
// Without Fix 1 this returns null.
test('getCombo: omitting sinceMs defaults to 90-day window (Fix 1 regression)', () => {
  // Use seen_at values 20 days ago — well within the 90-day default window.
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 20 * day);
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 21 * day);
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 22 * day);
  insertRow('LHR', 'SYD', 'A388', 'BAW', now - 23 * day);
  insertRow('JFK', 'LAX', 'A388', 'BAW', now - 24 * day);

  openFlightsService.getAirline.mockImplementation((iata) => {
    if (iata === 'BA') return BA_AIRLINE;
    return null;
  });
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);

  // No sinceMs — must not return null due to NaN default.
  const result = getCombo({ iataAirline: 'BA', icaoAircraft: 'A388' });

  expect(result).not.toBeNull();
  expect(result.routes).toHaveLength(5);
});

// ── Test 8: listValidCombinations default sinceMs ────────────────────────────
//
// Insert BAW/A388 with 5 recent pairs. Call listValidCombinations without sinceMs.
// Without Fix 1 this returns [].
test('listValidCombinations: omitting sinceMs defaults to 90-day window (Fix 1 regression)', () => {
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 20 * day);
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 21 * day);
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 22 * day);
  insertRow('LHR', 'SYD', 'A388', 'BAW', now - 23 * day);
  insertRow('JFK', 'LAX', 'A388', 'BAW', now - 24 * day);

  openFlightsService.getAirlineByIcao.mockImplementation((icao) => {
    if (icao?.toUpperCase() === 'BAW') return BA_AIRLINE;
    return null;
  });

  // No sinceMs — must not return [] due to NaN default.
  const combos = listValidCombinations({ minPairs: 5 });

  expect(combos).toHaveLength(1);
  expect(combos[0].iata).toBe('BA');
  expect(combos[0].icao_aircraft).toBe('A388');
});

// ── Test 9: aircraft slug — known family ──────────────────────────────────────
//
// A388 is a known ICAO code that resolves to a family with a display name.
// Expects: result.aircraft.slug is a non-empty kebab-case string.
test('aircraft slug: known family (A388) → slug is populated', () => {
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 2 * day);
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 3 * day);
  insertRow('LHR', 'SYD', 'A388', 'BAW', now - 4 * day);
  insertRow('JFK', 'LAX', 'A388', 'BAW', now - 5 * day);

  openFlightsService.getAirline.mockImplementation((iata) => (iata === 'BA' ? BA_AIRLINE : null));
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);

  const result = getCombo({ iataAirline: 'BA', icaoAircraft: 'A388', sinceMs: now - 90 * day });

  expect(result).not.toBeNull();
  expect(result.aircraft.slug).not.toBeNull();
  expect(typeof result.aircraft.slug).toBe('string');
  expect(result.aircraft.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
});

// ── Test 10: aircraft slug — unknown ICAO → null ──────────────────────────────
//
// 'ZZZZ' is an unrecognised ICAO code (no family match).
// Expects: result.aircraft.slug is null.
test('aircraft slug: unknown ICAO (ZZZZ) → slug is null', () => {
  insertRow('LHR', 'JFK', 'ZZZZ', 'BAW', now - 1 * day);
  insertRow('LHR', 'LAX', 'ZZZZ', 'BAW', now - 2 * day);
  insertRow('LHR', 'SIN', 'ZZZZ', 'BAW', now - 3 * day);
  insertRow('LHR', 'SYD', 'ZZZZ', 'BAW', now - 4 * day);
  insertRow('JFK', 'LAX', 'ZZZZ', 'BAW', now - 5 * day);

  openFlightsService.getAirline.mockImplementation((iata) => (iata === 'BA' ? BA_AIRLINE : null));
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);

  const result = getCombo({ iataAirline: 'BA', icaoAircraft: 'ZZZZ', sinceMs: now - 90 * day });

  expect(result).not.toBeNull();
  expect(result.aircraft.icao).toBe('ZZZZ');
  expect(result.aircraft.slug).toBeNull();
});

// ── Test 11: getTopAircraftForAirline returns top N by pair count desc ─────────
//
// Insert BAW with 3 aircraft types at 10, 5, 2 pairs.
// Expects: result sorted desc, top-2 at limit 2 are the 10-pair and 5-pair types.
test('getTopAircraftForAirline: returns top N aircraft by pair count, descending', () => {
  // 10 distinct pairs for B77W
  const pairs10 = [
    ['LHR', 'JFK'], ['LHR', 'LAX'], ['LHR', 'SIN'], ['LHR', 'SYD'], ['JFK', 'LAX'],
    ['JFK', 'SIN'], ['JFK', 'SYD'], ['LAX', 'SIN'], ['LAX', 'SYD'], ['SIN', 'SYD'],
  ];
  for (const [dep, arr] of pairs10) {
    insertRow(dep, arr, 'B77W', 'BAW', now - 1 * day);
  }
  // 5 pairs for A388
  const pairs5 = [['LHR', 'JFK'], ['LHR', 'LAX'], ['LHR', 'SIN'], ['LHR', 'SYD'], ['JFK', 'LAX']];
  for (const [dep, arr] of pairs5) {
    insertRow(dep, arr, 'A388', 'BAW', now - 1 * day);
  }
  // 2 pairs for B789
  insertRow('LHR', 'JFK', 'B789', 'BAW', now - 1 * day);
  insertRow('LHR', 'LAX', 'B789', 'BAW', now - 1 * day);

  openFlightsService.getAirline.mockImplementation((iata) => (iata === 'BA' ? BA_AIRLINE : null));

  const result = getTopAircraftForAirline({ iataAirline: 'BA', sinceMs: now - 90 * day, limit: 2 });

  expect(result).toHaveLength(2);
  expect(result[0].icao_aircraft).toBe('B77W');
  expect(result[0].n_pairs).toBe(10);
  expect(result[1].icao_aircraft).toBe('A388');
  expect(result[1].n_pairs).toBe(5);
  // n_pairs are in descending order
  expect(result[0].n_pairs).toBeGreaterThan(result[1].n_pairs);
});

// ── Test 12: getTopAircraftForAirline filters out aircraft with 0 pairs ────────
//
// Only aircraft with at least 1 distinct pair in the window should appear.
// Rows outside the window should not count.
test('getTopAircraftForAirline: filters out aircraft with 0 pairs in window', () => {
  // Insert B77W with 5 pairs inside window
  const pairs5 = [['LHR', 'JFK'], ['LHR', 'LAX'], ['LHR', 'SIN'], ['LHR', 'SYD'], ['JFK', 'LAX']];
  for (const [dep, arr] of pairs5) {
    insertRow(dep, arr, 'B77W', 'BAW', now - 1 * day);
  }
  // Insert A388 rows but with seen_at OUTSIDE the window (200 days ago)
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 200 * day);
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 200 * day);

  openFlightsService.getAirline.mockImplementation((iata) => (iata === 'BA' ? BA_AIRLINE : null));

  const result = getTopAircraftForAirline({ iataAirline: 'BA', sinceMs: now - 90 * day, limit: 6 });

  // A388 rows are outside the 90-day window and must be excluded
  const icaos = result.map(r => r.icao_aircraft);
  expect(icaos).toContain('B77W');
  expect(icaos).not.toContain('A388');
  // All returned entries must have n_pairs > 0
  for (const r of result) {
    expect(r.n_pairs).toBeGreaterThan(0);
  }
});

// ── Test 13: listValidCombinations memoization — only one SQL call on 2nd invoke ─
//
// Spy on db.prepare so we can count how many times the GROUP-BY scan is actually
// executed. Two successive calls with identical args must result in exactly one
// real SQL execution (the second call is served from the in-process cache).
test('listValidCombinations: second call with same args hits cache (single SQL execution)', () => {
  let allCallCount = 0;
  const originalPrepare = db.prepare.bind(db);

  const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql) => {
    const stmt = originalPrepare(sql);
    if (sql.includes('HAVING n_pairs')) {
      // Wrap .all() to count actual SQL executions on the combo scan.
      const originalAll = stmt.all.bind(stmt);
      stmt.all = (...args) => {
        allCallCount++;
        return originalAll(...args);
      };
    }
    return stmt;
  });

  openFlightsService.getAirlineByIcao.mockReturnValue(null); // no results needed

  // Use a fixed sinceMs (bucketed to the same minute) so both calls map to the same key.
  const sinceMs = Math.floor(Date.now() / 60_000) * 60_000;

  listValidCombinations({ sinceMs, minPairs: 5 });
  listValidCombinations({ sinceMs, minPairs: 5 });

  expect(allCallCount).toBe(1);

  prepareSpy.mockRestore();
});

// ── Test 14: buildValidComboSet — key format ─────────────────────────────────
//
// Verifies the helper produces lowercase "iata:icao_aircraft" keys.
test('buildValidComboSet: builds lowercase iata:icao_aircraft keys', () => {
  const combos = [
    { iata: 'BA', icao_aircraft: 'A388', n_pairs: 10 },
    { iata: 'FR', icao_aircraft: 'B738', n_pairs: 7 },
  ];
  const set = buildValidComboSet(combos);
  expect(set.size).toBe(2);
  expect(set.has('ba:a388')).toBe(true);
  expect(set.has('fr:b738')).toBe(true);
  expect(set.has('BA:A388')).toBe(false);
});

// ── Test 15: getTopHubsForAirline — returns top dep airports desc ─────────────
//
// Insert 3 departure airports (LHR 3 routes, JFK 2 routes, LAX 1 route) for BAW.
// Expects: result sorted desc by pair_count, city/country enriched from getAirport.
test('getTopHubsForAirline: returns top departure airports by pair count, descending', () => {
  // LHR as dep: 3 distinct arr
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'LAX', 'A388', 'BAW', now - 1 * day);
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 1 * day);
  // JFK as dep: 2 distinct arr
  insertRow('JFK', 'LHR', 'A388', 'BAW', now - 1 * day);
  insertRow('JFK', 'LAX', 'A388', 'BAW', now - 1 * day);
  // LAX as dep: 1 distinct arr
  insertRow('LAX', 'SIN', 'A388', 'BAW', now - 1 * day);

  openFlightsService.getAirline.mockImplementation((iata) => (iata === 'BA' ? BA_AIRLINE : null));
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);

  const result = getTopHubsForAirline({ iataAirline: 'BA', sinceMs: now - 90 * day, limit: 3 });

  expect(result).toHaveLength(3);
  expect(result[0].iata).toBe('LHR');
  expect(result[0].pair_count).toBe(3);
  expect(result[0].city).toBe('London');
  expect(result[0].country).toBe('GB');
  expect(result[1].iata).toBe('JFK');
  expect(result[1].pair_count).toBe(2);
  expect(result[2].iata).toBe('LAX');
  expect(result[2].pair_count).toBe(1);
});

// ── Test 16: getTopHubsForAirline — unresolvable airline → [] ────────────────
test('getTopHubsForAirline: unresolvable airline returns empty array', () => {
  openFlightsService.getAirline.mockReturnValue(null);
  const result = getTopHubsForAirline({ iataAirline: 'XX', sinceMs: now - 90 * day });
  expect(result).toEqual([]);
});

// ── Test 17: getTopDestinationsForAirline — returns top arr airports desc ─────
//
// Insert routes where JFK appears as arr 3 times, SIN 2 times, SYD 1 time.
// Expects: result sorted desc by pair_count, city/country enriched.
test('getTopDestinationsForAirline: returns top arrival airports by pair count, descending', () => {
  // JFK as arr: 3 distinct dep
  insertRow('LHR', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('LAX', 'JFK', 'A388', 'BAW', now - 1 * day);
  insertRow('SIN', 'JFK', 'A388', 'BAW', now - 1 * day);
  // SIN as arr: 2 distinct dep
  insertRow('LHR', 'SIN', 'A388', 'BAW', now - 1 * day);
  insertRow('JFK', 'SIN', 'A388', 'BAW', now - 1 * day);
  // SYD as arr: 1 distinct dep
  insertRow('LHR', 'SYD', 'A388', 'BAW', now - 1 * day);

  openFlightsService.getAirline.mockImplementation((iata) => (iata === 'BA' ? BA_AIRLINE : null));
  openFlightsService.getAirport.mockImplementation((iata) => AIRPORTS[iata?.toUpperCase()] || null);

  const result = getTopDestinationsForAirline({ iataAirline: 'BA', sinceMs: now - 90 * day, limit: 3 });

  expect(result).toHaveLength(3);
  expect(result[0].iata).toBe('JFK');
  expect(result[0].pair_count).toBe(3);
  expect(result[0].city).toBe('New York');
  expect(result[1].iata).toBe('SIN');
  expect(result[1].pair_count).toBe(2);
  expect(result[2].iata).toBe('SYD');
  expect(result[2].pair_count).toBe(1);
});

// ── Test 18: getTopDestinationsForAirline — unresolvable airline → [] ─────────
test('getTopDestinationsForAirline: unresolvable airline returns empty array', () => {
  openFlightsService.getAirline.mockReturnValue(null);
  const result = getTopDestinationsForAirline({ iataAirline: 'XX', sinceMs: now - 90 * day });
  expect(result).toEqual([]);
});

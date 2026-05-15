'use strict';

/**
 * Tests for aircraftRouteService.getVariantData() and the updated listQualifying().
 *
 * Uses real in-memory SQLite (NODE_ENV=test from setup.js).
 * openFlightsService is mocked to avoid loading airports.dat.
 *
 * CRITICAL: observed_routes.airline_iata stores ICAO codes despite the column
 * name (e.g. 'BAW' not 'BA'). All seed rows use ICAO codes. Lookup happens
 * via getAirlineByIcao().
 */

jest.mock('../services/openFlightsService', () => ({
  getAirport:       jest.fn(),
  getAirline:       jest.fn(),
  getAirlineByIcao: jest.fn(),
  isValidAirport:   jest.fn(() => true),
}));

// Prevent caches from leaking between tests
const aircraftRouteService = require('../services/aircraftRouteService');
const db                   = require('../models/db');
const openFlights          = require('../services/openFlightsService');

const NOW = Date.now();
// Use a large positive sinceMs so test seeds (inserted "now") are always in window
const SINCE_FUTURE = 0; // 0 → everything qualifies

function seedRoute({ depIata, arrIata, aircraftIcao, airlineIata, sinceMs = NOW - 1000 }) {
  // Clear possible PK conflict: delete then insert
  db.db.prepare('DELETE FROM observed_routes WHERE dep_iata=? AND arr_iata=? AND aircraft_icao=?')
    .run(depIata, arrIata, aircraftIcao);
  db.db.prepare(`
    INSERT INTO observed_routes (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
    VALUES (?,?,?,?,?,?,?)
  `).run(depIata, arrIata, aircraftIcao, airlineIata || null, NOW, sinceMs, 'test-var');
}

beforeEach(() => {
  jest.clearAllMocks();
  aircraftRouteService._resetCaches();
  // Clean test data
  db.db.exec("DELETE FROM observed_routes WHERE source='test-var'");
});

afterAll(() => {
  db.db.exec("DELETE FROM observed_routes WHERE source='test-var'");
});

// ── Airport and airline mock helpers ─────────────────────────────────────────

function mockAirports() {
  openFlights.getAirport.mockImplementation((iata) => {
    const map = {
      LHR: { iata: 'LHR', name: 'London Heathrow', city: 'London',   country: 'United Kingdom', lat: 51.477, lon: -0.461, icao: 'EGLL' },
      SIN: { iata: 'SIN', name: 'Singapore Changi', city: 'Singapore', country: 'Singapore',      lat: 1.359, lon:  103.989, icao: 'WSSS' },
    };
    return map[iata?.toUpperCase()] || null;
  });
}

function mockAirlines() {
  openFlights.getAirlineByIcao.mockImplementation((icao) => {
    const map = {
      SIA: { iata: 'SQ', icao: 'SIA', name: 'Singapore Airlines', country: 'Singapore' },
      BAW: { iata: 'BA', icao: 'BAW', name: 'British Airways',     country: 'United Kingdom' },
    };
    return map[icao?.toUpperCase()] || null;
  });
}

// ── Test suite 1: getVariantData returns null on missing observations ─────────

describe('getVariantData — returns null when no observations', () => {
  test('returns null when 0 rows in 14-day window', () => {
    mockAirports();
    mockAirlines();
    // No rows seeded — expect null
    const result = aircraftRouteService.getVariantData({ from: 'LHR', to: 'SIN', slug: 'airbus-a380' });
    expect(result).toBeNull();
  });

  test('returns null when airport unknown', () => {
    openFlights.getAirport.mockReturnValue(null);
    seedRoute({ depIata: 'LHR', arrIata: 'SIN', aircraftIcao: 'A388', airlineIata: 'SIA' });
    const result = aircraftRouteService.getVariantData({ from: 'LHR', to: 'SIN', slug: 'airbus-a380' });
    expect(result).toBeNull();
  });

  test('returns null when slug is unknown', () => {
    mockAirports();
    seedRoute({ depIata: 'LHR', arrIata: 'SIN', aircraftIcao: 'A388', airlineIata: 'SIA' });
    const result = aircraftRouteService.getVariantData({ from: 'LHR', to: 'SIN', slug: 'unknown-aircraft-slug' });
    expect(result).toBeNull();
  });

  test('returns null when missing from/to/slug args', () => {
    expect(aircraftRouteService.getVariantData()).toBeNull();
    expect(aircraftRouteService.getVariantData({ from: 'LHR' })).toBeNull();
    expect(aircraftRouteService.getVariantData({ from: 'LHR', to: 'SIN' })).toBeNull();
  });
});

// ── Test suite 2: getVariantData returns full payload with ≥1 observation ────

describe('getVariantData — returns full payload with ≥1 observation', () => {
  let result;

  beforeEach(() => {
    mockAirports();
    mockAirlines();
    // Seed: A380 on LHR-SIN with 2 distinct airlines (SIA more frequent)
    // Need distinct aircraft_icao for PK: A388 for SIA, A380 also for SIA (different row)
    // Actually PK is (dep_iata, arr_iata, aircraft_icao) — use different icaos or different time
    db.db.exec("DELETE FROM observed_routes WHERE source='test-var'");
    db.db.prepare(`
      INSERT INTO observed_routes (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
      VALUES (?,?,?,?,?,?,?)
    `).run('LHR', 'SIN', 'A388', 'SIA', NOW, NOW - 10000, 'test-var');
    // Add second row for BAW using different aircraft_icao
    db.db.prepare(`
      INSERT INTO observed_routes (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
      VALUES (?,?,?,?,?,?,?)
    `).run('LHR', 'SIN', 'A380', 'BAW', NOW - 1000, NOW - 20000, 'test-var');
    // Seed a Boeing 777 on LHR-SIN (for other_aircraft)
    db.db.prepare(`
      INSERT OR IGNORE INTO observed_routes (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
      VALUES (?,?,?,?,?,?,?)
    `).run('LHR', 'SIN', 'B77W', 'SIA', NOW - 500, NOW - 5000, 'test-var');

    aircraftRouteService._resetCaches();
    result = aircraftRouteService.getVariantData({ from: 'LHR', to: 'SIN', slug: 'airbus-a380', sinceMs: 0 });
  });

  test('result is not null', () => {
    expect(result).not.toBeNull();
  });

  test('dep and arr airport info populated', () => {
    expect(result.dep.iata).toBe('LHR');
    expect(result.dep.city).toBe('London');
    expect(result.arr.iata).toBe('SIN');
    expect(result.arr.city).toBe('Singapore');
  });

  test('family info populated', () => {
    expect(result.family.slug).toBe('airbus-a380');
    expect(result.family.label).toMatch(/A380/i);
    expect(Array.isArray(result.family.icao_list)).toBe(true);
    expect(result.family.icao_list.length).toBeGreaterThan(0);
  });

  test('operators sorted DESC by obs_count', () => {
    expect(Array.isArray(result.operators)).toBe(true);
    for (let i = 1; i < result.operators.length; i++) {
      expect(result.operators[i - 1].obs_count).toBeGreaterThanOrEqual(result.operators[i].obs_count);
    }
  });

  test('operators have required fields', () => {
    for (const op of result.operators) {
      expect(op).toHaveProperty('iata');
      expect(op).toHaveProperty('icao');
      expect(op).toHaveProperty('name');
      expect(op).toHaveProperty('obs_count');
      expect(op).toHaveProperty('first_seen_at');
      expect(op).toHaveProperty('last_seen_at');
    }
  });

  test('observed_count matches row count', () => {
    // We seeded 2 A380-family rows (A388 + A380)
    expect(result.observed_count).toBe(2);
  });

  test('distance and flight time computed', () => {
    expect(typeof result.distance_km).toBe('number');
    expect(result.distance_km).toBeGreaterThan(0);
    expect(typeof result.estimated_time_str).toBe('string');
    expect(result.estimated_time_str).toMatch(/^\d+h \d+m$/);
  });

  test('other_aircraft populated (Boeing 777 seeded)', () => {
    // B77W resolves to boeing-777 family
    expect(Array.isArray(result.other_aircraft)).toBe(true);
    const slugs = result.other_aircraft.map((ac) => ac.slug);
    // Not necessarily boeing-777 by slug but at least one entry
    expect(result.other_aircraft.length).toBeGreaterThanOrEqual(1);
    for (const ac of result.other_aircraft) {
      expect(ac).toHaveProperty('slug');
      expect(ac).toHaveProperty('name');
      expect(ac).toHaveProperty('obs_count');
    }
  });

  test('other_aircraft does NOT include the queried family itself', () => {
    const slugs = result.other_aircraft.map((ac) => ac.slug);
    expect(slugs).not.toContain('airbus-a380');
  });
});

// ── Test suite 3: listQualifying no longer returns combo_count:0 entries ─────

describe('listQualifying — no editorial combos with combo_count 0', () => {
  test('every returned entry has combo_count >= 1', () => {
    const entries = aircraftRouteService.listQualifying({ limit: 100 });
    for (const e of entries) {
      expect(e.combo_count).toBeGreaterThanOrEqual(1);
    }
  });

  test('returns array (may be empty if no data)', () => {
    const entries = aircraftRouteService.listQualifying();
    expect(Array.isArray(entries)).toBe(true);
  });

  test('respects limit', () => {
    // Seed a few real rows
    mockAirports();
    db.db.exec("DELETE FROM observed_routes WHERE source='test-var'");
    db.db.prepare(`
      INSERT INTO observed_routes (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
      VALUES (?,?,?,?,?,?,?)
    `).run('LHR', 'SIN', 'A388', 'SIA', NOW, NOW - 1000, 'test-var');
    const entries = aircraftRouteService.listQualifying({ limit: 1 });
    expect(entries.length).toBeLessThanOrEqual(1);
  });
});

'use strict';

// Mock openFlightsService to avoid loading airports.dat on test boot.
jest.mock('../services/openFlightsService', () => ({
  getAirport: jest.fn(),
  getAirline: jest.fn(),
  getAirlineByIcao: jest.fn(),
  isValidAirport: jest.fn(() => true),
  getCity: jest.fn((iata) => iata),
  getCountry: jest.fn(() => null),
  getAllAirports: jest.fn(() => []),
}));

// Mock aircraftFamilies so getFamilyByCode returns predictable values.
// The real module is pure JS but loads a large family list — we stub it to
// keep tests hermetic and fast.
jest.mock('../models/aircraftFamilies', () => {
  const actual = jest.requireActual('../models/aircraftFamilies');
  return {
    ...actual,
    getFamilyByCode: jest.fn((code) => {
      const lookup = {
        B789: { name: 'Boeing 787', family: {}, label: 'Boeing 787 Dreamliner' },
        A320: { name: 'Airbus A320', family: {}, label: 'Airbus A320 family' },
      };
      return lookup[String(code).toUpperCase()] || null;
    }),
  };
});

const { db } = require('../models/db');
const {
  distinctAirlinesWithCounts,
  distinctAircraftWithCounts,
} = require('../models/observedRoutes');
const openFlightsService = require('../services/openFlightsService');
const { getFamilyByCode } = require('../models/aircraftFamilies');

const SOURCE = 'test-distinct-counts';
const now  = Date.now();
const day  = 24 * 60 * 60 * 1000;

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
  // Default airline name lookup
  openFlightsService.getAirline.mockImplementation((iata) => {
    const airlines = {
      BA: { name: 'British Airways', iata: 'BA' },
      AA: { name: 'American Airlines', iata: 'AA' },
    };
    return airlines[iata?.toUpperCase()] || null;
  });
  // getFamilyByCode mock is set at the top of the file
});

afterAll(() => {
  db.exec(`DELETE FROM observed_routes WHERE source = '${SOURCE}'`);
});

// ── distinctAirlinesWithCounts ───────────────────────────────────────────────

test('distinctAirlinesWithCounts: returns airlines sorted by count DESC with resolved names', () => {
  // BA appears on 2 distinct rows (different aircraft ⇒ different PKs), AA on 1
  insertRow('LHR', 'JFK', 'B789', 'BA', now - 1 * day);
  insertRow('LHR', 'CDG', 'A320', 'BA', now - 2 * day);
  insertRow('JFK', 'CDG', 'B789', 'AA', now - 1 * day);

  const sinceMs = now - 30 * day;
  const result  = distinctAirlinesWithCounts(sinceMs);

  expect(result.length).toBeGreaterThanOrEqual(2);

  const ba = result.find(r => r.iata === 'BA');
  expect(ba).toBeDefined();
  expect(ba.name).toBe('British Airways');
  expect(ba.count).toBe(2);

  const aa = result.find(r => r.iata === 'AA');
  expect(aa).toBeDefined();
  expect(aa.name).toBe('American Airlines');
  expect(aa.count).toBe(1);

  // BA (count=2) should come before AA (count=1)
  expect(result.indexOf(ba)).toBeLessThan(result.indexOf(aa));
});

test('distinctAirlinesWithCounts: unknown airline iata falls back to raw iata as name', () => {
  // 'ZZ' is not in the mock airlinesMap
  insertRow('LHR', 'SYD', 'B789', 'ZZ', now - 1 * day);
  openFlightsService.getAirline.mockImplementation(() => null);

  const result = distinctAirlinesWithCounts(now - 30 * day);

  const zz = result.find(r => r.iata === 'ZZ');
  expect(zz).toBeDefined();
  expect(zz.name).toBe('ZZ');  // fallback: raw iata code
  expect(zz.count).toBe(1);
});

// ── distinctAircraftWithCounts ───────────────────────────────────────────────

test('distinctAircraftWithCounts: returns aircraft sorted by count DESC with family labels', () => {
  // B789 on 2 distinct rows, A320 on 1
  insertRow('LHR', 'JFK', 'B789', 'BA', now - 1 * day);
  insertRow('LHR', 'CDG', 'B789', 'AA', now - 2 * day);
  insertRow('JFK', 'CDG', 'A320', 'BA', now - 1 * day);

  const sinceMs = now - 30 * day;
  const result  = distinctAircraftWithCounts(sinceMs);

  expect(result.length).toBeGreaterThanOrEqual(2);

  const b789 = result.find(r => r.icao === 'B789');
  expect(b789).toBeDefined();
  expect(b789.label).toBe('Boeing 787 Dreamliner');
  expect(b789.count).toBe(2);

  const a320 = result.find(r => r.icao === 'A320');
  expect(a320).toBeDefined();
  expect(a320.label).toBe('Airbus A320 family');
  expect(a320.count).toBe(1);

  // B789 (count=2) should come before A320 (count=1)
  expect(result.indexOf(b789)).toBeLessThan(result.indexOf(a320));
});

test('distinctAircraftWithCounts: unknown ICAO code falls back to raw icao as label', () => {
  // 'UNKN' is not in the mock getFamilyByCode lookup
  insertRow('LHR', 'SYD', 'UNKN', 'BA', now - 1 * day);
  getFamilyByCode.mockReturnValue(null);

  const result = distinctAircraftWithCounts(now - 30 * day);

  const unkn = result.find(r => r.icao === 'UNKN');
  expect(unkn).toBeDefined();
  expect(unkn.label).toBe('UNKN');  // fallback: raw icao code
  expect(unkn.count).toBe(1);
});

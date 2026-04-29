const path = require('path');
const fixture = require(path.join(__dirname, 'fixtures', 'ita-matrix-response.json'));
const svc = require('../services/itaMatrixService');

// Parse tests use the pre-parsed inner_json companion.
const innerJson = fixture.inner_json;

describe('itaMatrixService.parse', () => {
  test('parses inner JSON into normalized flight array', () => {
    const flights = svc.parse(innerJson);
    expect(Array.isArray(flights)).toBe(true);
    expect(flights.length).toBeGreaterThan(0);

    const f = flights[0];
    expect(f.departure.code).toMatch(/^[A-Z]{3}$/);
    expect(f.arrival.code).toMatch(/^[A-Z]{3}$/);
    expect(typeof f.duration).toBe('number');
    expect(f.duration).toBeGreaterThan(30);
    expect(f.duration).toBeLessThan(48 * 60);
    expect(f.source).toBe('ita');
    expect(Array.isArray(f.segments)).toBe(true);
    expect(f.segments.length).toBeGreaterThan(0);
    expect(typeof f.stops).toBe('number');
  });

  test('uses displayTotal as canonical price (not ext.price)', () => {
    const flights = svc.parse(innerJson);
    const f = flights[0];
    expect(f.price).not.toBeNull();
    expect(typeof f.price.amount).toBe('number');
    expect(f.price.currency).toMatch(/^[A-Z]{3}$/);
    // displayTotal in fixture is e.g. "EUR589.94" — verify we parsed correctly
    const firstSolution = innerJson.solutionList.solutions[0];
    const expectedAmount = parseFloat(firstSolution.displayTotal.replace(/[A-Z]/g, ''));
    expect(f.price.amount).toBeCloseTo(expectedAmount, 2);
  });

  test('returns empty array on missing/empty input', () => {
    expect(svc.parse({})).toEqual([]);
    expect(svc.parse(null)).toEqual([]);
    expect(svc.parse({ solutionList: null })).toEqual([]);
    expect(svc.parse({ solutionList: { solutions: [] } })).toEqual([]);
  });

  test('every parsed flight has source: "ita" and IATA codes', () => {
    const flights = svc.parse(innerJson);
    flights.forEach(f => {
      expect(f.source).toBe('ita');
      expect(f.departure.code).toMatch(/^[A-Z]{3}$/);
      expect(f.arrival.code).toMatch(/^[A-Z]{3}$/);
    });
  });
});

const axios = require('axios');
jest.mock('axios');

describe('itaMatrixService.search', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null when live search is not wired (current behaviour)', async () => {
    const result = await svc.search({ departure: 'LIS', arrival: 'JFK', date: '2026-06-01' });
    expect(result).toBeNull();
  });
});

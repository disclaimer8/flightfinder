'use strict';

/**
 * Tests for the SSR top-routes-and-prices block injected into bAircraft (T7).
 *
 * The builder under test is the sync build() path with meta.kind === 'aircraft'.
 * All external dependencies are mocked — no real SQLite, no real
 * openFlightsService, no real routePricingService.
 *
 * Four behaviours covered:
 *  1. Block renders when service returns >= 3 routes.
 *  2. Block is omitted when service returns fewer than 3 routes.
 *  3. icaoList variants are merged — highest n_quotes wins per (dep, arr).
 *  4. SSR survives (no throw) when service throws — block omitted.
 */

jest.mock('../services/routePricingService', () => ({
  getRoutesForAircraft: jest.fn(),
}));

// Pass-through chrome so we can assert on inner HTML directly.
jest.mock('../services/seoChrome', () => ({
  applyChrome: (_meta, html) => html || '',
}));

jest.mock('../services/airlineAircraftService', () => ({
  listValidCombinations: jest.fn(() => []),
  buildValidComboSet:    jest.fn(() => new Set()),
}));

jest.mock('../services/openFlightsService', () => ({
  getAirport:       jest.fn(() => null),
  getAirlineByIcao: jest.fn(),
  isValidAirport:   jest.fn(() => true),
}));

jest.mock('../services/fr24CacheService', () => ({
  get: jest.fn(() => null),
}));

const fakeDb = {
  getAircraftFacts: () => ({ airlineCount: 3, routeCount: 5 }),
  getAircraftTopRoutes: () => [],
  getAircraftOperators: () => [],
};

const builders = require('../services/seoContentBuilders');
const rpSvc = require('../services/routePricingService');

beforeEach(() => { jest.clearAllMocks(); });

describe('bAircraft SSR — top routes block', () => {
  it('emits data-widget when service returns >= 3 routes', () => {
    rpSvc.getRoutesForAircraft.mockReturnValue([
      { dep_iata: 'LHR', arr_iata: 'JFK', dep_city: 'London', arr_city: 'New York',
        median_eur: 500, min_eur: 400, max_eur: 600, n_quotes: 12 },
      { dep_iata: 'LAX', arr_iata: 'LHR', dep_city: 'Los Angeles', arr_city: 'London',
        median_eur: 620, min_eur: 500, max_eur: 800, n_quotes: 8 },
      { dep_iata: 'SFO', arr_iata: 'LHR', dep_city: 'San Francisco', arr_city: 'London',
        median_eur: 700, min_eur: 600, max_eur: 900, n_quotes: 5 },
    ]);
    const html = builders.build({
      kind: 'aircraft', icaoList: ['B789'], aircraftLabel: 'Boeing 787-9', slug: 'boeing-787-9',
    }, fakeDb);
    expect(html).toContain('data-widget="aircraft-top-routes-prices"');
    expect(html).toContain('Where the Boeing 787-9 flies');
    expect(html).toContain('London → New York');
    expect(html).toContain('€500');
    expect(html).toContain('/routes/lhr-jfk');
  });

  it('omits block when fewer than 3 routes', () => {
    rpSvc.getRoutesForAircraft.mockReturnValue([
      { dep_iata: 'LHR', arr_iata: 'JFK', dep_city: 'London', arr_city: 'New York',
        median_eur: 500, n_quotes: 12 },
      { dep_iata: 'LAX', arr_iata: 'LHR', dep_city: 'Los Angeles', arr_city: 'London',
        median_eur: 620, n_quotes: 8 },
    ]);
    const html = builders.build({
      kind: 'aircraft', icaoList: ['B789'], aircraftLabel: 'Boeing 787-9', slug: 'boeing-787-9',
    }, fakeDb);
    expect(html).not.toContain('data-widget="aircraft-top-routes-prices"');
  });

  it('merges across icaoList (highest n_quotes wins per pair)', () => {
    rpSvc.getRoutesForAircraft.mockImplementation((icao) => {
      if (icao === 'B789') return [
        { dep_iata: 'LHR', arr_iata: 'JFK', dep_city: 'London', arr_city: 'New York',
          median_eur: 500, n_quotes: 12 },
        { dep_iata: 'LAX', arr_iata: 'LHR', dep_city: 'Los Angeles', arr_city: 'London',
          median_eur: 620, n_quotes: 8 },
      ];
      if (icao === 'B78X') return [
        { dep_iata: 'LHR', arr_iata: 'JFK', dep_city: 'London', arr_city: 'New York',
          median_eur: 550, n_quotes: 20 },
        { dep_iata: 'SFO', arr_iata: 'LHR', dep_city: 'San Francisco', arr_city: 'London',
          median_eur: 700, n_quotes: 5 },
      ];
      return [];
    });
    const html = builders.build({
      kind: 'aircraft', icaoList: ['B789', 'B78X'], aircraftLabel: 'Boeing 787', slug: 'boeing-787',
    }, fakeDb);
    expect(html).toContain('data-widget="aircraft-top-routes-prices"');
    const lhrJfkCount = (html.match(/\/routes\/lhr-jfk/g) || []).length;
    expect(lhrJfkCount).toBe(1);
    expect(html).toContain('€550');
  });

  it('survives when price service throws', () => {
    rpSvc.getRoutesForAircraft.mockImplementation(() => { throw new Error('db down'); });
    const html = builders.build({
      kind: 'aircraft', icaoList: ['B789'], aircraftLabel: 'Boeing 787-9', slug: 'boeing-787-9',
    }, fakeDb);
    expect(html).not.toContain('data-widget="aircraft-top-routes-prices"');
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });
});

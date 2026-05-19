'use strict';

/**
 * Tests for the SSR price block injected into bRoute (T6).
 *
 * The builder under test is the sync build() path with meta.kind === 'route'.
 * All external dependencies are mocked — no real SQLite, no real
 * openFlightsService, no real routeService, no real routePricingService.
 *
 * Three behaviours covered:
 *  1. Block renders when routePricingService returns rows.
 *  2. Block is omitted when service returns an empty array.
 *  3. SSR survives (no throw) when service throws — block omitted.
 */

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('../services/routePricingService', () => ({
  getPricesForRoute: jest.fn(),
}));

jest.mock('../services/routeService', () => ({
  getRouteData:          jest.fn(),
  listValidRoutePairs:   jest.fn(() => []),
  getTopRoutesFromCity:  jest.fn(() => []),
  getTopRoutesToCity:    jest.fn(() => []),
  _resetCaches:          jest.fn(),
}));

jest.mock('../services/openFlightsService', () => ({
  getAirport:       jest.fn(() => null),
  getAirlineByIcao: jest.fn(),
  isValidAirport:   jest.fn(() => true),
}));

// Pass-through chrome so we can assert on inner HTML directly.
jest.mock('../services/seoChrome', () => ({
  applyChrome: (_meta, html) => html || '',
}));

jest.mock('../services/fr24CacheService', () => ({
  get: jest.fn(() => null),
}));

jest.mock('../services/airlineAircraftService', () => ({
  listValidCombinations: jest.fn(() => []),
  buildValidComboSet:    jest.fn(() => new Set()),
}));

jest.mock('../services/aircraftRouteService', () => ({
  isQualifying:   jest.fn(() => false),
  listQualifying: jest.fn(() => []),
}));

jest.mock('../services/amadeusAnalyticsService', () => ({
  getAirlineRoutes:             jest.fn(() => Promise.resolve(null)),
  getAirportDirectDestinations: jest.fn(() => Promise.resolve(null)),
}));

// Silence jonty enrichment.
jest.mock('../models/jontyDb', () => ({
  getDb: () => { throw new Error('jonty.db not present'); },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ROUTE_FIXTURE = {
  dep: { iata: 'LHR', lat: 51.477, lon: -0.461, city: 'London',   country: 'United Kingdom' },
  arr: { iata: 'JFK', lat: 40.641, lon: -73.778, city: 'New York', country: 'United States' },
  distance_km:        5541,
  estimated_hours:    6.85,
  estimated_time_str: '6h 51m',
  operators: [
    { iata: 'BA', icao: 'BAW', name: 'British Airways', aircraft_count: 2, obs_count: 50 },
  ],
  aircraft: [
    { icao: 'B789', name: 'Boeing 787', operator_count: 3, obs_count: 30 },
  ],
  summary: {
    total_observations: 50,
    distinct_operators: 1,
    distinct_aircraft:  1,
  },
};

// ── Setup ─────────────────────────────────────────────────────────────────────

const routeService = require('../services/routeService');
const rpSvc = require('../services/routePricingService');

beforeEach(() => {
  jest.clearAllMocks();
  routeService.getRouteData.mockReturnValue(ROUTE_FIXTURE);
  routeService.getTopRoutesFromCity.mockReturnValue([]);
  routeService.getTopRoutesToCity.mockReturnValue([]);
});

// Load builder AFTER mocks established.
const { build } = require('../services/seoContentBuilders');

const META = {
  kind:     'route',
  fromIata: 'LHR',
  toIata:   'JFK',
  fromName: 'London Heathrow',
  toName:   'New York JFK',
  pair:     'lhr-jfk',
};

describe('bRoute SSR — prices block', () => {
  it('emits data-widget="route-aircraft-prices" when prices exist', () => {
    rpSvc.getPricesForRoute.mockReturnValue([
      {
        aircraft_icao: 'B789',
        aircraft_name: 'Boeing 787-9',
        aircraft_slug: 'boeing-787-9',
        median_eur: 500, min_eur: 400, max_eur: 600, n_quotes: 8,
        airlines: ['BAW'],
        airlines_display: 'British Airways',
        safety: { accident_count_5y: 0, level: 'green' },
        snapshot_at: 1,
      },
    ]);
    const html = build(META);
    expect(typeof html).toBe('string');
    expect(html).toContain('data-widget="route-aircraft-prices"');
    expect(html).toContain('Boeing 787-9');
    expect(html).toContain('€500');
    expect(html).toContain('British Airways');
  });

  it('omits prices block when service returns empty', () => {
    rpSvc.getPricesForRoute.mockReturnValue([]);
    const html = build(META);
    expect(typeof html).toBe('string');
    expect(html).not.toContain('data-widget="route-aircraft-prices"');
  });

  it('SSR survives when price service throws', () => {
    rpSvc.getPricesForRoute.mockImplementation(() => { throw new Error('db down'); });
    const html = build(META);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('data-widget="route-aircraft-prices"');
  });

  it('thin path adds pricesBlock + drops noindex when prices exist', () => {
    const routeService = require('../services/routeService');
    routeService.getRouteData.mockReturnValueOnce(null); // thin
    rpSvc.getPricesForRoute.mockReturnValue([
      { aircraft_icao: 'B789', aircraft_name: 'Boeing 787-9', aircraft_slug: 'boeing-787-9',
        median_eur: 500, min_eur: 400, max_eur: 600, n_quotes: 8,
        airlines: ['BAW'], airlines_display: 'British Airways',
        safety: { accident_count_5y: 0, level: 'green' }, snapshot_at: 1 },
    ]);
    const html = build({
      kind: 'route', fromIata: 'LHR', toIata: 'JFK',
      fromName: 'London Heathrow', toName: 'New York JFK',
      pair: 'lhr-jfk',
    });
    expect(html).toContain('data-widget="route-aircraft-prices"');
    expect(html).not.toMatch(/noindex/i);
  });

  it('thin path keeps noindex when no prices exist', () => {
    const routeService = require('../services/routeService');
    routeService.getRouteData.mockReturnValueOnce(null);
    rpSvc.getPricesForRoute.mockReturnValue([]);
    const html = build({
      kind: 'route', fromIata: 'XXX', toIata: 'YYY',
      fromName: 'Nowhere', toName: 'Elsewhere',
      pair: 'xxx-yyy',
    });
    expect(html).not.toContain('data-widget="route-aircraft-prices"');
    expect(html).toMatch(/noindex/i);
  });
});

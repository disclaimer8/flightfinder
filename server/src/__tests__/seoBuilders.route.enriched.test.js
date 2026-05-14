'use strict';

/**
 * Tests for the enriched bRoute builder (F2).
 *
 * All external dependencies are mocked — no real SQLite, no real
 * openFlightsService, no real routeService. The builder under test is the
 * sync build() path with meta.kind === 'route'.
 */

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('../services/routeService', () => ({
  getRouteData:          jest.fn(),
  listValidRoutePairs:   jest.fn(),
  getTopRoutesFromCity:  jest.fn(),
  getTopRoutesToCity:    jest.fn(),
  _resetCaches:          jest.fn(),
}));

jest.mock('../services/openFlightsService', () => ({
  getAirport:       jest.fn(),
  getAirlineByIcao: jest.fn(),
  isValidAirport:   jest.fn(() => true),
}));

// seoChrome injects chrome around inner HTML; return passthrough for tests.
jest.mock('../services/seoChrome', () => ({
  applyChrome: (_meta, html) => html || '',
}));

// fr24CacheService — not relevant for this test.
jest.mock('../services/fr24CacheService', () => ({
  get: jest.fn(() => null),
}));

// airlineAircraftService — needed by bAircraftAirlines, not bRoute.
jest.mock('../services/airlineAircraftService', () => ({
  listValidCombinations: jest.fn(() => []),
  buildValidComboSet:    jest.fn(() => new Set()),
}));

// aircraftRouteService — needed by seoMetaService but not bRoute.
jest.mock('../services/aircraftRouteService', () => ({
  isQualifying: jest.fn(() => false),
  listQualifying: jest.fn(() => []),
}));

// Prevent amadeusAnalyticsService from touching real network.
jest.mock('../services/amadeusAnalyticsService', () => ({
  getAirlineRoutes:              jest.fn(() => Promise.resolve(null)),
  getAirportDirectDestinations:  jest.fn(() => Promise.resolve(null)),
}));

// ── Fixture data ──────────────────────────────────────────────────────────────

const ROUTE_FIXTURE = {
  dep: { iata: 'LHR', lat: 51.477, lon: -0.461, city: 'London', country: 'United Kingdom' },
  arr: { iata: 'JFK', lat: 40.641, lon: -73.778, city: 'New York', country: 'United States' },
  distance_km:        5541,
  estimated_hours:    6.85,
  estimated_time_str: '6h 51m',
  operators: [
    { iata: 'BA', icao: 'BAW', name: 'British Airways', aircraft_count: 4, obs_count: 53 },
    { iata: 'AA', icao: 'AAL', name: 'American Airlines', aircraft_count: 3, obs_count: 40 },
    { iata: 'VS', icao: 'VIR', name: 'Virgin Atlantic', aircraft_count: 2, obs_count: 30 },
    { iata: 'UA', icao: 'UAL', name: 'United Airlines', aircraft_count: 2, obs_count: 25 },
    { iata: 'DL', icao: 'DAL', name: 'Delta Air Lines', aircraft_count: 3, obs_count: 20 },
  ],
  aircraft: [
    { icao: 'B77W', name: 'Boeing 777', operator_count: 5, obs_count: 60 },
    { icao: 'A350', name: 'Airbus A350', operator_count: 3, obs_count: 40 },
    { icao: 'B789', name: 'Boeing 787', operator_count: 4, obs_count: 35 },
    { icao: 'A380', name: 'Airbus A380', operator_count: 2, obs_count: 20 },
    { icao: 'A388', name: 'Airbus A380-800', operator_count: 1, obs_count: 10 },
  ],
  summary: {
    total_observations: 165,
    distinct_operators: 5,
    distinct_aircraft:  5,
  },
};

const FROM_ROUTES_FIXTURE = [
  { arr_iata: 'CDG', arr_city: 'Paris',     arr_country: 'France',      count: 80 },
  { arr_iata: 'AMS', arr_city: 'Amsterdam', arr_country: 'Netherlands', count: 70 },
  { arr_iata: 'FRA', arr_city: 'Frankfurt', arr_country: 'Germany',     count: 60 },
];

const TO_ROUTES_FIXTURE = [
  { dep_iata: 'LAX', dep_city: 'Los Angeles', dep_country: 'US', count: 50 },
  { dep_iata: 'ORD', dep_city: 'Chicago',     dep_country: 'US', count: 40 },
];

// ── Setup helpers ─────────────────────────────────────────────────────────────

const routeService       = require('../services/routeService');
const openFlightsService = require('../services/openFlightsService');

function setupValidRoute() {
  routeService.getRouteData.mockReturnValue(ROUTE_FIXTURE);
  routeService.getTopRoutesFromCity.mockReturnValue(FROM_ROUTES_FIXTURE);
  routeService.getTopRoutesToCity.mockReturnValue(TO_ROUTES_FIXTURE);
  openFlightsService.getAirport.mockImplementation(iata => {
    const map = {
      LHR: { iata: 'LHR', name: 'London Heathrow', city: 'London', country: 'United Kingdom', icao: 'EGLL' },
      JFK: { iata: 'JFK', name: 'John F. Kennedy International', city: 'New York', country: 'United States', icao: 'KJFK' },
    };
    return map[iata?.toUpperCase()] || null;
  });
}

function setupThinRoute() {
  routeService.getRouteData.mockReturnValue(null);
  routeService.getTopRoutesFromCity.mockReturnValue([]);
  routeService.getTopRoutesToCity.mockReturnValue([]);
  openFlightsService.getAirport.mockReturnValue(null);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Load builders after mocks are established ─────────────────────────────────
const { build } = require('../services/seoContentBuilders');

const META_BASE = {
  kind:     'route',
  fromIata: 'LHR',
  toIata:   'JFK',
  fromName: 'London Heathrow',
  toName:   'John F. Kennedy International',
};

// ── Test 1: Valid route — all 6 sections present ─────────────────────────────

describe('bRoute — valid route (routeService returns data)', () => {
  let html;

  beforeEach(() => {
    setupValidRoute();
    html = build(META_BASE);
  });

  test('renders hero metrics section', () => {
    expect(html).toMatch(/route-hero-metrics/);
    expect(html).toMatch(/Distance/);
    expect(html).toMatch(/Flight time/);
    expect(html).toMatch(/Airlines/);
    expect(html).toMatch(/Aircraft types/);
    expect(html).toMatch(/5,541/);
    expect(html).toMatch(/6h 51m/);
  });

  test('renders operators table section', () => {
    expect(html).toMatch(/route-operators/);
    expect(html).toMatch(/Airlines flying LHR/);
    expect(html).toMatch(/British Airways/);
    expect(html).toMatch(/American Airlines/);
    expect(html).toMatch(/href="\/airline\/ba"/);
    expect(html).toMatch(/Airline.*Aircraft types.*Observations/s);
  });

  test('renders aircraft section', () => {
    expect(html).toMatch(/route-aircraft/);
    expect(html).toMatch(/Aircraft on this route/);
    expect(html).toMatch(/Boeing 777/);
    expect(html).toMatch(/Airbus A350/);
  });

  test('renders airport details section', () => {
    expect(html).toMatch(/route-airports/);
    expect(html).toMatch(/Airport details/);
    expect(html).toMatch(/Departure/);
    expect(html).toMatch(/London Heathrow/);
    expect(html).toMatch(/EGLL/);
    expect(html).toMatch(/Arrival/);
    expect(html).toMatch(/Kennedy/);
    expect(html).toMatch(/KJFK/);
  });

  test('renders cross-routes section', () => {
    expect(html).toMatch(/route-cross/);
    expect(html).toMatch(/Other routes from London/);
    expect(html).toMatch(/Other routes to New York/);
    expect(html).toMatch(/href="\/routes\/lhr-cdg"/);
    expect(html).toMatch(/href="\/routes\/lhr-ams"/);
    expect(html).toMatch(/href="\/routes\/lax-jfk"/);
  });

  test('renders FAQ section with 4 data-driven questions', () => {
    expect(html).toMatch(/route-faq/);
    expect(html).toMatch(/How many airlines fly LHR to JFK/);
    expect(html).toMatch(/What aircraft fly the LHR-JFK route/);
    expect(html).toMatch(/How long is the.*flight/);
    expect(html).toMatch(/What.*distance from/);
    // Concrete answer data
    expect(html).toMatch(/5 airline/);
    expect(html).toMatch(/Boeing 777/);
    expect(html).toMatch(/6h 51m/);
    expect(html).toMatch(/5,541/);
  });

  test('emits FAQPage JSON-LD with all 4 Q&A', () => {
    expect(html).toMatch(/"@type"\s*:\s*"FAQPage"/);
    expect(html).toMatch(/How many airlines fly LHR to JFK/);
    expect(html).toMatch(/What aircraft fly the LHR-JFK route/);
    expect(html).toMatch(/How long is the/);
    expect(html).toMatch(/What.*distance from/);
  });

  test('does NOT emit noindex meta on valid route', () => {
    expect(html).not.toMatch(/noindex/);
  });

  test('operators table links use lowercase iata', () => {
    expect(html).toMatch(/href="\/airline\/ba"/);
    expect(html).toMatch(/href="\/airline\/aa"/);
    // Must NOT have uppercase airline hrefs
    expect(html).not.toMatch(/href="\/airline\/BA"/);
  });
});

// ── Test 2: Thin pair — noindex, no rich sections ────────────────────────────

describe('bRoute — thin pair (routeService returns null)', () => {
  let html;

  beforeEach(() => {
    setupThinRoute();
    html = build(META_BASE);
  });

  test('emits noindex meta', () => {
    expect(html).toMatch(/noindex/);
  });

  test('does NOT render hero metrics section', () => {
    expect(html).not.toMatch(/route-hero-metrics/);
  });

  test('does NOT render operators table', () => {
    expect(html).not.toMatch(/route-operators/);
  });

  test('does NOT render aircraft section', () => {
    expect(html).not.toMatch(/route-aircraft/);
  });

  test('does NOT render airport details section', () => {
    expect(html).not.toMatch(/route-airports/);
  });

  test('does NOT render cross-routes section', () => {
    expect(html).not.toMatch(/route-cross/);
  });

  test('still renders a FAQ section', () => {
    expect(html).toMatch(/route-faq/);
  });
});

// ── Test 3: Cross-routes anchors use lowercase IATAs ─────────────────────────

describe('bRoute — cross-routes lowercase href format', () => {
  test('all cross-route anchors have lowercase IATA codes in href', () => {
    setupValidRoute();
    const html = build(META_BASE);
    // Extract all /routes/ hrefs
    const routeHrefs = [...html.matchAll(/href="(\/routes\/[^"]+)"/g)].map(m => m[1]);
    expect(routeHrefs.length).toBeGreaterThan(0);
    for (const href of routeHrefs) {
      // Should be all lowercase after /routes/
      expect(href).toMatch(/^\/routes\/[a-z]{3}-[a-z]{3}$/);
    }
  });
});

// ── Test 4: Aircraft slug resolution ─────────────────────────────────────────

describe('bRoute — aircraft slug resolution', () => {
  test('known aircraft family renders as a link', () => {
    // Boeing 777 is a known family with slug boeing-777
    const fixture = {
      ...ROUTE_FIXTURE,
      aircraft: [
        { icao: 'B77W', name: 'Boeing 777', operator_count: 5, obs_count: 60 },
      ],
    };
    routeService.getRouteData.mockReturnValue(fixture);
    routeService.getTopRoutesFromCity.mockReturnValue([]);
    routeService.getTopRoutesToCity.mockReturnValue([]);
    openFlightsService.getAirport.mockReturnValue({
      iata: 'LHR', name: 'London Heathrow', city: 'London', country: 'GB',
    });

    const html = build(META_BASE);
    // Should have a link to /aircraft/boeing-777 (or similar slug)
    expect(html).toMatch(/href="\/aircraft\//);
    expect(html).toMatch(/Boeing 777/);
  });

  test('unknown aircraft name with no family renders as plain text (no link)', () => {
    const unknownAcFixture = {
      ...ROUTE_FIXTURE,
      aircraft: [
        { icao: 'ZZZZ', name: '!!invalid aircraft name!!', operator_count: 1, obs_count: 5 },
      ],
    };
    routeService.getRouteData.mockReturnValue(unknownAcFixture);
    routeService.getTopRoutesFromCity.mockReturnValue([]);
    routeService.getTopRoutesToCity.mockReturnValue([]);
    openFlightsService.getAirport.mockReturnValue({
      iata: 'LHR', name: 'London Heathrow', city: 'London', country: 'GB',
    });

    const html = build(META_BASE);
    // The name text should appear but NOT as a link (no /aircraft/ href for invalid slug)
    // A slug of '!!invalid aircraft name!!' -> slugify -> '--invalid-aircraft-name--' or similar
    // which contains non-[a-z0-9-] chars → rendered as plain text.
    // We verify the aircraft section appears but no /aircraft/!! href
    expect(html).toMatch(/route-aircraft/);
    // No link with invalid chars
    expect(html).not.toMatch(/href="\/aircraft\/!!/);
  });
});

// ── Test 5: Sitemap enumerateRouteMatrix ─────────────────────────────────────

describe('enumerateRouteMatrix', () => {
  const { enumerateRouteMatrix } = require('../services/seoUrlEnumerator');

  test('returns sitemap entries for each valid pair', () => {
    routeService.listValidRoutePairs.mockReturnValue([
      { from: 'LHR', to: 'JFK', op_count: 5, ac_count: 4 },
      { from: 'CDG', to: 'LAX', op_count: 3, ac_count: 2 },
      { from: 'AMS', to: 'JFK', op_count: 4, ac_count: 3 },
    ]);

    const entries = enumerateRouteMatrix();
    expect(entries).toHaveLength(3);
  });

  test('loc uses lowercase IATAs and correct base URL', () => {
    routeService.listValidRoutePairs.mockReturnValue([
      { from: 'LHR', to: 'JFK', op_count: 5, ac_count: 4 },
    ]);

    const entries = enumerateRouteMatrix();
    expect(entries[0].loc).toBe('https://himaxym.com/routes/lhr-jfk');
  });

  test('each entry has required sitemap fields', () => {
    routeService.listValidRoutePairs.mockReturnValue([
      { from: 'LHR', to: 'JFK', op_count: 5, ac_count: 4 },
    ]);

    const entries = enumerateRouteMatrix();
    const entry = entries[0];
    expect(entry).toHaveProperty('loc');
    expect(entry).toHaveProperty('priority', '0.5');
    expect(entry).toHaveProperty('changefreq', 'weekly');
    expect(entry).toHaveProperty('lastmod');
    expect(entry.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('returns empty array when routeService throws', () => {
    routeService.listValidRoutePairs.mockImplementation(() => {
      throw new Error('DB unavailable');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const entries = enumerateRouteMatrix();
    warnSpy.mockRestore();
    expect(entries).toEqual([]);
  });

  test('3 valid pairs produce 3 sitemap entries', () => {
    routeService.listValidRoutePairs.mockReturnValue([
      { from: 'LHR', to: 'JFK', op_count: 5, ac_count: 4 },
      { from: 'CDG', to: 'ORD', op_count: 3, ac_count: 2 },
      { from: 'AMS', to: 'LAX', op_count: 4, ac_count: 3 },
    ]);
    const entries = enumerateRouteMatrix();
    expect(entries).toHaveLength(3);
    const locs = entries.map(e => e.loc);
    expect(locs).toContain('https://himaxym.com/routes/lhr-jfk');
    expect(locs).toContain('https://himaxym.com/routes/cdg-ord');
    expect(locs).toContain('https://himaxym.com/routes/ams-lax');
  });
});

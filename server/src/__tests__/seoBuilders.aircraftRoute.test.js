'use strict';

/**
 * Tests for the enriched bAircraftRoute builder.
 *
 * All external dependencies mocked — no real SQLite, no real openFlightsService.
 * The builder is exercised via build() with meta.kind === 'aircraft-route'.
 */

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('../services/aircraftRouteService', () => ({
  getVariantData:    jest.fn(),
  isQualifying:      jest.fn(() => true),
  listQualifying:    jest.fn(() => []),
  _resetCaches:      jest.fn(),
}));

jest.mock('../services/openFlightsService', () => ({
  getAirport:       jest.fn(),
  getAirlineByIcao: jest.fn(),
  isValidAirport:   jest.fn(() => true),
}));

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

jest.mock('../services/routeService', () => ({
  getRouteData:         jest.fn(() => null),
  listValidRoutePairs:  jest.fn(() => []),
  getTopRoutesFromCity: jest.fn(() => []),
  getTopRoutesToCity:   jest.fn(() => []),
  _resetCaches:         jest.fn(),
}));

jest.mock('../services/amadeusAnalyticsService', () => ({
  getAirlineRoutes:             jest.fn(() => Promise.resolve(null)),
  getAirportDirectDestinations: jest.fn(() => Promise.resolve(null)),
}));

// ── Fixture data ──────────────────────────────────────────────────────────────

const VARIANT_FIXTURE = {
  dep: { iata: 'LHR', lat: 51.477, lon: -0.461, city: 'London',    country: 'United Kingdom' },
  arr: { iata: 'SIN', lat:  1.359, lon: 103.989, city: 'Singapore', country: 'Singapore'      },
  family: {
    slug:      'airbus-a380',
    name:      'Airbus A380',
    label:     'Airbus A380',
    icao_list: ['A388', 'A380'],
  },
  distance_km:        10841,
  estimated_time_str: '13h 4m',
  operators: [
    { iata: 'SQ', icao: 'SIA', name: 'Singapore Airlines', country: 'Singapore', obs_count: 42, first_seen_at: Date.now() - 14*86400000, last_seen_at: Date.now() - 1000 },
    { iata: 'BA', icao: 'BAW', name: 'British Airways',    country: 'UK',        obs_count: 18, first_seen_at: Date.now() - 10*86400000, last_seen_at: Date.now() - 2000 },
  ],
  other_aircraft: [
    { slug: 'boeing-777', name: 'Boeing 777 (all variants)', obs_count: 30 },
    { slug: 'airbus-a350', name: 'Airbus A350',              obs_count: 12 },
  ],
  observed_count: 60,
};

// ── Setup helpers ─────────────────────────────────────────────────────────────

const aircraftRouteService = require('../services/aircraftRouteService');
const openFlightsService   = require('../services/openFlightsService');

function setupRichVariant() {
  aircraftRouteService.getVariantData.mockReturnValue(VARIANT_FIXTURE);
  openFlightsService.getAirport.mockImplementation((iata) => {
    const map = {
      LHR: { iata: 'LHR', name: 'London Heathrow',  city: 'London',    country: 'United Kingdom', icao: 'EGLL' },
      SIN: { iata: 'SIN', name: 'Singapore Changi', city: 'Singapore', country: 'Singapore',      icao: 'WSSS' },
    };
    return map[iata?.toUpperCase()] || null;
  });
}

function setupEmptyVariant() {
  aircraftRouteService.getVariantData.mockReturnValue(null);
  openFlightsService.getAirport.mockReturnValue(null);
}

beforeEach(() => {
  jest.clearAllMocks();
});

const { build } = require('../services/seoContentBuilders');

const META_BASE = {
  kind:         'aircraft-route',
  fromIata:     'LHR',
  toIata:       'SIN',
  slug:         'airbus-a380',
  pair:         'lhr-sin',
  fromName:     'London',
  toName:       'Singapore',
  aircraftLabel: 'Airbus A380',
};

// ── Test 1: Empty pair — noindex + minimal body ───────────────────────────────

describe('bAircraftRoute — empty pair (getVariantData returns null)', () => {
  let html;

  beforeEach(() => {
    setupEmptyVariant();
    html = build(META_BASE);
  });

  test('emits noindex meta', () => {
    expect(html).toMatch(/noindex/);
  });

  test('emits cross-link to parent /routes/{pair} page', () => {
    expect(html).toMatch(/href="\/routes\/lhr-sin"/);
  });

  test('emits cross-link to /aircraft/{slug}', () => {
    expect(html).toMatch(/href="\/aircraft\/airbus-a380"/);
  });

  test('does NOT render hero metrics section', () => {
    expect(html).not.toMatch(/variant-route-hero-metrics/);
  });

  test('does NOT render operators table', () => {
    expect(html).not.toMatch(/variant-route-operators/);
  });

  test('does NOT render FAQ section', () => {
    expect(html).not.toMatch(/variant-route-faq/);
  });
});

// ── Test 2: Rich pair — all 6 sections + JSON-LD ─────────────────────────────

describe('bAircraftRoute — rich pair (getVariantData returns data)', () => {
  let html;

  beforeEach(() => {
    setupRichVariant();
    html = build(META_BASE);
  });

  test('renders hero metrics section with distance, flight time, operators, observations', () => {
    expect(html).toMatch(/variant-route-hero-metrics/);
    expect(html).toMatch(/Distance/);
    expect(html).toMatch(/Est. flight time/);
    expect(html).toMatch(/13h 4m/);
    expect(html).toMatch(/10,841/);
    expect(html).toMatch(/Observations/);
    expect(html).toMatch(/60/);
  });

  test('renders operators table with airline names and obs counts', () => {
    expect(html).toMatch(/variant-route-operators/);
    expect(html).toMatch(/Singapore Airlines/);
    expect(html).toMatch(/British Airways/);
    expect(html).toMatch(/href="\/airline\/sq"/);
    expect(html).toMatch(/href="\/airline\/ba"/);
    // Columns present
    expect(html).toMatch(/Airline/);
    expect(html).toMatch(/Observations/);
    expect(html).toMatch(/First seen/);
    expect(html).toMatch(/Last seen/);
  });

  test('renders aircraft callout section with family name and cross-links', () => {
    expect(html).toMatch(/variant-route-callout/);
    expect(html).toMatch(/Airbus A380/);
    expect(html).toMatch(/href="\/aircraft\/airbus-a380"/);
    expect(html).toMatch(/safety/);
  });

  test('renders other aircraft section with cross-links to /routes/{pair}/{slug}', () => {
    expect(html).toMatch(/variant-route-other-aircraft/);
    expect(html).toMatch(/Boeing 777/);
    expect(html).toMatch(/href="\/routes\/lhr-sin\/boeing-777"/);
    expect(html).toMatch(/Airbus A350/);
    expect(html).toMatch(/href="\/routes\/lhr-sin\/airbus-a350"/);
  });

  test('renders airport details section for both dep and arr', () => {
    expect(html).toMatch(/variant-route-airports/);
    expect(html).toMatch(/Departure/);
    expect(html).toMatch(/London Heathrow/);
    expect(html).toMatch(/EGLL/);
    expect(html).toMatch(/Arrival/);
    expect(html).toMatch(/Singapore Changi/);
    expect(html).toMatch(/WSSS/);
  });

  test('renders FAQ section with all 4 questions', () => {
    expect(html).toMatch(/variant-route-faq/);
    expect(html).toMatch(/Which airlines fly the Airbus A380/);
    expect(html).toMatch(/How often does the Airbus A380 fly/);
    expect(html).toMatch(/What.*distance from/);
    expect(html).toMatch(/What other aircraft fly/);
  });

  test('FAQ section has concrete answers', () => {
    expect(html).toMatch(/Singapore Airlines/);
    expect(html).toMatch(/60/); // observed_count in answer
    expect(html).toMatch(/10,841/); // distance in answer
    expect(html).toMatch(/Boeing 777/); // other aircraft in answer
  });

  test('emits FAQPage JSON-LD', () => {
    expect(html).toMatch(/"@type"\s*:\s*"FAQPage"/);
    expect(html).toMatch(/Which airlines fly the Airbus A380/);
  });

  test('emits BreadcrumbList JSON-LD with Home > Routes > pair > aircraft', () => {
    expect(html).toMatch(/"@type"\s*:\s*"BreadcrumbList"/);
    expect(html).toMatch(/"Home"/);
    expect(html).toMatch(/"Routes"/);
    expect(html).toMatch(/LHR-SIN/);
    expect(html).toMatch(/Airbus A380/);
  });

  test('does NOT emit noindex on rich pair', () => {
    expect(html).not.toMatch(/noindex/);
  });

  test('airline links use lowercase iata codes', () => {
    // Must have /airline/sq and /airline/ba, NOT uppercase
    expect(html).toMatch(/href="\/airline\/sq"/);
    expect(html).toMatch(/href="\/airline\/ba"/);
    expect(html).not.toMatch(/href="\/airline\/SQ"/);
    expect(html).not.toMatch(/href="\/airline\/BA"/);
  });
});

// ── Test 3: JSON-LD escape safety ─────────────────────────────────────────────

describe('bAircraftRoute — JSON-LD </script> escape', () => {
  test('does not contain raw </script> inside JSON-LD', () => {
    setupRichVariant();
    const html = build(META_BASE);
    // The JSON blob should NOT have literal </script> in it (it should be escaped)
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      expect(jsonLdMatch[1]).not.toMatch(/<\/script>/i);
    }
  });
});

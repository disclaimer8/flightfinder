'use strict';

/**
 * Tests for bAccident builder — specifically the normalizeForFamily helper
 * that strips variant suffixes before resolveFamily lookup.
 *
 * accidentNarrativeService and aircraftFamilies are mocked so no real DB
 * or static-data access occurs.
 */

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('../services/accidentNarrativeService', () => ({
  getBySlug:             jest.fn(),
  listSimilarByAircraft: jest.fn(() => []),
}));

jest.mock('../models/aircraftFamilies', () => {
  const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // resolveFamily is called with the normalizeForFamily output. Map canonical
  // base-model strings to the expected family records.
  const resolveFamily = jest.fn((input) => {
    if (!input || typeof input !== 'string') return null;
    const normalised = input.trim().toLowerCase();
    if (normalised === 'boeing 737')  return { name: 'Boeing 737',  family: {}, icaoList: ['B738'] };
    if (normalised === 'airbus a321') return { name: 'Airbus A321', family: {}, icaoList: ['A321'] };
    return null;
  });
  return {
    getFamilyList:   jest.fn(() => []),
    getFamilyByCode: jest.fn(() => null),
    getFamilyBySlug: jest.fn(() => null),
    slugify,
    resolveFamily,
    getFamilyCodes:  jest.fn(() => []),
    getFamilyRange:  jest.fn(() => null),
  };
});

jest.mock('../services/seoChrome', () => ({
  applyChrome:      (meta, inner) => inner || '',
  applyChromeAsync: async (meta, inner) => inner || '',
}));

jest.mock('../services/openFlightsService', () => ({
  getAirline:       jest.fn(),
  getAirlineByIcao: jest.fn(),
  getAirport:       jest.fn(),
  isValidAirport:   jest.fn(() => true),
  getCity:          jest.fn((iata) => iata),
  getCountry:       jest.fn(() => null),
  getAllAirports:    jest.fn(() => []),
  getAirportByIcao: jest.fn(() => null),
  iataForIcao:      jest.fn(() => null),
}));

jest.mock('../services/airlineAircraftService', () => ({
  getCombo:                 jest.fn(),
  listValidCombinations:    jest.fn(() => []),
  getTopAircraftForAirline: jest.fn(() => []),
  buildValidComboSet:       jest.fn(() => new Set()),
}));

jest.mock('../services/aircraftLandingEnrichment', () => ({
  getEnrichmentForSlug:    jest.fn(() => null),
  renderVariantsTable:     jest.fn(() => ''),
  renderNotableIncidents:  jest.fn(() => ''),
  renderVariantCallout:    jest.fn(() => ''),
  renderEnhancedFAQ:       jest.fn(() => ''),
  buildVariantsItemListLD: jest.fn(() => []),
  buildFAQPageLD:          jest.fn(() => null),
}));

jest.mock('../models/aircraftVariants', () => ({
  getAllVariants:           jest.fn(() => []),
  getVariantBySlug:        jest.fn(() => null),
  getVariantsByFamilySlug: jest.fn(() => []),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = 1715500000;

function makeAccidentData(aircraft_model, operator = 'Test Airline') {
  return {
    slug: 'test-slug',
    source: 'ntsb',
    source_url: 'https://carol.ntsb.gov/event/E1',
    indexable: 1,
    narrative_text: 'The aircraft was destroyed.',
    probable_cause: null,
    factors_json: null,
    phase_of_flight: null,
    weather_summary: null,
    ingested_at: NOW,
    updated_at: NOW,
    factors: [],
    related: { byAircraft: [], byOperator: [] },
    facts: {
      id: 1,
      date: '2024-01-15',
      normalized_date: '2024-01-15',
      aircraft_model,
      operator,
      fatalities: '3',
      location: 'Denver, CO',
      lat: 39.74,
      lon: -104.98,
      source_url: 'https://carol.ntsb.gov/event/E1',
      registration: null,
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const accidentSvc = require('../services/accidentNarrativeService');
const { bAccident } = require('../services/seoContentBuilders');

beforeEach(() => {
  jest.clearAllMocks();
  accidentSvc.listSimilarByAircraft.mockReturnValue([]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bAccident — normalizeForFamily cross-link', () => {
  test('"BOEING 737-800" produces a cross-link to /aircraft/boeing-737/safety', async () => {
    accidentSvc.getBySlug.mockReturnValue(makeAccidentData('BOEING 737-800'));
    const html = await bAccident('test-slug');
    expect(html).toMatch(/href="\/aircraft\/boeing-737\/safety"/);
    expect(html).toMatch(/Boeing 737/);
  });

  test('"AIRBUS A321-271NX" produces a cross-link to /aircraft/airbus-a321/safety', async () => {
    accidentSvc.getBySlug.mockReturnValue(makeAccidentData('AIRBUS A321-271NX'));
    const html = await bAccident('test-slug');
    expect(html).toMatch(/href="\/aircraft\/airbus-a321\/safety"/);
    expect(html).toMatch(/Airbus A321/);
  });

  test('"EMBRAER ERJ-175" gracefully produces no aircraft cross-link', async () => {
    accidentSvc.getBySlug.mockReturnValue(makeAccidentData('EMBRAER ERJ-175'));
    const html = await bAccident('test-slug');
    // No /aircraft/.../safety link should appear
    expect(html).not.toMatch(/href="\/aircraft\/[^"]+\/safety"/);
  });

  test('empty / missing aircraft_model gracefully produces no cross-link', async () => {
    accidentSvc.getBySlug.mockReturnValue(makeAccidentData(''));
    const html = await bAccident('test-slug');
    expect(html).not.toMatch(/href="\/aircraft\/[^"]+\/safety"/);
  });
});

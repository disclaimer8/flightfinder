'use strict';

/**
 * Tests for bAirlineAircraft builder and enumerateAirlineAircraftMatrix.
 *
 * airlineAircraftService is mocked at module level — no real DB access.
 * seoMetaService is NOT mocked so esc() works normally.
 */

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('../services/airlineAircraftService', () => ({
  getCombo:                  jest.fn(),
  listValidCombinations:     jest.fn(),
  getTopAircraftForAirline:  jest.fn(),
  buildValidComboSet:        jest.fn((combos) =>
    new Set((combos || []).map(c => `${c.iata.toLowerCase()}:${c.icao_aircraft.toLowerCase()}`))
  ),
}));

// Minimal openFlightsService stub (seoContentBuilders may indirectly load it
// via seoMetaService; keep it simple).
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

// seoChrome: return innerHtml wrapped in a div so we can grep it
jest.mock('../services/seoChrome', () => ({
  applyChrome:      (meta, inner) => `<div data-chrome>${inner || ''}</div>`,
  applyChromeAsync: async (meta, inner) => `<div data-chrome>${inner || ''}</div>`,
}));

// aircraftFamilies stubs — only what builders need
jest.mock('../models/aircraftFamilies', () => {
  const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    getFamilyList:   jest.fn(() => []),
    getFamilyByCode: jest.fn(() => null),
    getFamilyBySlug: jest.fn(() => null),
    slugify,
    resolveFamily:   jest.fn(() => null),
    getFamilyCodes:  jest.fn(() => []),
    getFamilyRange:  jest.fn(() => null),
  };
});

// aircraftVariants stub
jest.mock('../models/aircraftVariants', () => ({
  getAllVariants:          jest.fn(() => []),
  getVariantBySlug:        jest.fn(() => null),
  getVariantsByFamilySlug: jest.fn(() => []),
}));

// aircraftLandingEnrichment stub
jest.mock('../services/aircraftLandingEnrichment', () => ({
  getEnrichmentForSlug:    jest.fn(() => null),
  renderVariantsTable:     jest.fn(() => ''),
  renderNotableIncidents:  jest.fn(() => ''),
  renderVariantCallout:    jest.fn(() => ''),
  renderEnhancedFAQ:       jest.fn(() => ''),
  buildVariantsItemListLD: jest.fn(() => []),
  buildFAQPageLD:          jest.fn(() => null),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

const now = Date.now();
const day = 86400000;

const FAKE_COMBO = {
  airline: { iata: 'BA', icao: 'BAW', name: 'British Airways', country: 'GB' },
  aircraft: { icao: 'A388', name: 'Airbus A380', category: 'wide-body' },
  summary: {
    n_pairs:    5,
    n_airports: 6,
    longest:  { dep: 'LHR', arr: 'SYD', distance_km: 16993 },
    shortest: { dep: 'LHR', arr: 'CDG', distance_km: 340 },
  },
  routes: [
    { dep: { iata: 'LHR' }, arr: { iata: 'JFK' }, distance_km: 5540,  last_seen_at: now - 1 * day },
    { dep: { iata: 'LHR' }, arr: { iata: 'LAX' }, distance_km: 8757,  last_seen_at: now - 2 * day },
    { dep: { iata: 'LHR' }, arr: { iata: 'SIN' }, distance_km: 10841, last_seen_at: now - 3 * day },
    { dep: { iata: 'LHR' }, arr: { iata: 'SYD' }, distance_km: 16993, last_seen_at: now - 4 * day },
    { dep: { iata: 'LHR' }, arr: { iata: 'CDG' }, distance_km: 340,   last_seen_at: now - 5 * day },
  ],
};

// ── Setup ─────────────────────────────────────────────────────────────────────

const airlineAircraftService = require('../services/airlineAircraftService');
const builders = require('../services/seoContentBuilders');
const { enumerateAirlineAircraftMatrix } = require('../services/seoUrlEnumerator');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Test 1: Valid combo ───────────────────────────────────────────────────────

describe('bAirlineAircraft — valid combo', () => {
  let html;

  beforeEach(() => {
    airlineAircraftService.getCombo.mockReturnValue(FAKE_COMBO);
    html = builders.build({
      kind:  'airline-aircraft',
      iata:  'BA',
      icao:  'A388',
      h1:    'British Airways routes on the Airbus A380',
      subtitle: '',
    }, {});
  });

  test('H1 contains airline name', () => {
    expect(html).toMatch(/British Airways/);
  });

  test('H1 contains aircraft name', () => {
    expect(html).toMatch(/Airbus A380/);
  });

  test('routes table has 5 rows', () => {
    const matches = html.match(/<tr>/g);
    // 5 data rows + 1 header row = 6 <tr> tags
    expect(matches).not.toBeNull();
    // Count tbody rows by searching for <td> opening tags
    const tdMatches = html.match(/<td>/g);
    // 5 rows × 4 columns = 20 <td> elements
    expect(tdMatches).toHaveLength(20);
  });

  test('FAQ contains all 4 questions', () => {
    expect(html).toMatch(/How many routes does British Airways fly on the Airbus A380/);
    expect(html).toMatch(/What is the longest route/);
    expect(html).toMatch(/What is the shortest route/);
    expect(html).toMatch(/Which airports does British Airways use for the Airbus A380/);
  });

  test('JSON-LD contains FAQPage', () => {
    expect(html).toMatch(/"@type"\s*:\s*"FAQPage"/);
  });

  test('JSON-LD contains ItemList', () => {
    expect(html).toMatch(/"@type"\s*:\s*"ItemList"/);
  });

  test('JSON-LD contains BreadcrumbList', () => {
    expect(html).toMatch(/"@type"\s*:\s*"BreadcrumbList"/);
  });
});

// ── Test 2: Thin combo (null from service) ────────────────────────────────────

describe('bAirlineAircraft — null from service (thin combo)', () => {
  let html;
  let meta;

  beforeEach(() => {
    airlineAircraftService.getCombo.mockReturnValue(null);
    meta = {
      kind:    'airline-aircraft',
      iata:    'BA',
      icao:    'A388',
      h1:      'British Airways routes on the Airbus A380',
      subtitle: '',
      robots:  'index, follow',
    };
    html = builders.build(meta, {});
  });

  test('HTML contains "No routes" message', () => {
    expect(html).toMatch(/No routes found/i);
  });

  test('robots is downgraded to noindex via meta mutation', () => {
    expect(meta.robots).toBe('noindex, follow');
  });

  test('inline <meta name="robots"> with noindex emitted', () => {
    expect(html).toMatch(/noindex/);
  });
});

// ── Test 3: Schema check — parse JSON-LD ─────────────────────────────────────

describe('bAirlineAircraft — schema check', () => {
  test('BreadcrumbList has 5 nodes, FAQPage has 4 questions, ItemList has 5 items', () => {
    airlineAircraftService.getCombo.mockReturnValue(FAKE_COMBO);
    const html = builders.build({
      kind:    'airline-aircraft',
      iata:    'BA',
      icao:    'A388',
      h1:      'British Airways routes on the Airbus A380',
      subtitle: '',
    }, {});

    // Extract JSON-LD script content
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const graph = JSON.parse(match[1]);
    expect(graph['@graph']).toHaveLength(3);

    const breadcrumb = graph['@graph'].find(n => n['@type'] === 'BreadcrumbList');
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb.itemListElement).toHaveLength(5);

    const faqPage = graph['@graph'].find(n => n['@type'] === 'FAQPage');
    expect(faqPage).toBeDefined();
    expect(faqPage.mainEntity).toHaveLength(4);

    const itemList = graph['@graph'].find(n => n['@type'] === 'ItemList');
    expect(itemList).toBeDefined();
    expect(itemList.itemListElement).toHaveLength(5);
  });
});

// ── Test 4: HTML escaping ─────────────────────────────────────────────────────

describe('bAirlineAircraft — HTML escaping', () => {
  test('injection attempt in airline name is escaped', () => {
    const maliciousCombo = {
      ...FAKE_COMBO,
      airline: {
        iata:    'XX',
        icao:    'XXX',
        name:    '<script>alert(1)</script>',
        country: 'GB',
      },
    };
    airlineAircraftService.getCombo.mockReturnValue(maliciousCombo);
    const html = builders.build({
      kind:    'airline-aircraft',
      iata:    'XX',
      icao:    'A388',
      h1:      '<script>alert(1)</script> routes on the Airbus A380',
      subtitle: '',
    }, {});

    // The airline name must be HTML-escaped in visible text nodes.
    expect(html).toMatch(/&lt;script&gt;/);
    // The </script> inside the JSON-LD payload must be escaped as <\/script>
    // so the HTML parser does not close the script block prematurely.
    expect(html).toContain('<\\/script>');
  });
});

// ── Test 5: Sitemap enumeration smoke ─────────────────────────────────────────

describe('enumerateAirlineAircraftMatrix — sitemap smoke', () => {
  test('returns 3 entries with correct path format', () => {
    airlineAircraftService.listValidCombinations.mockReturnValue([
      { iata: 'BA',  icao_aircraft: 'A388', n_pairs: 10 },
      { iata: 'LH',  icao_aircraft: 'A333', n_pairs: 7  },
      { iata: 'EK',  icao_aircraft: 'B77W', n_pairs: 15 },
    ]);

    const entries = enumerateAirlineAircraftMatrix();

    expect(entries).toHaveLength(3);
    expect(entries[0].loc).toBe('https://himaxym.com/airline/ba/aircraft/a388');
    expect(entries[1].loc).toBe('https://himaxym.com/airline/lh/aircraft/a333');
    expect(entries[2].loc).toBe('https://himaxym.com/airline/ek/aircraft/b77w');
    for (const e of entries) {
      expect(e.priority).toBe('0.5');
      expect(e.changefreq).toBe('weekly');
      expect(e.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ── Test 6: bAircraftAirlines — matrix-aware operator links ──────────────────
//
// bAircraftAirlines renders <a href="/airline/{iata}/aircraft/{icao}"> for operators
// that have a valid matrix combo, and plain text for operators that do not.

const openFlightsService = require('../services/openFlightsService');

describe('bAircraftAirlines — matrix-aware operator links', () => {
  // Fake db stub: getAircraftOperators returns two operators stored as ICAO codes.
  const fakeDb = {
    getAircraftOperators: jest.fn().mockReturnValue([
      { airline: 'BAW', count: 42 }, // BA — has matrix page
      { airline: 'RYR', count: 15 }, // FR — no matrix page
    ]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.getAircraftOperators.mockReturnValue([
      { airline: 'BAW', count: 42 },
      { airline: 'RYR', count: 15 },
    ]);

    // BA has a matrix page for B738; FR does not.
    airlineAircraftService.listValidCombinations.mockReturnValue([
      { iata: 'BA', icao_aircraft: 'B738', n_pairs: 10 },
    ]);

    // Resolve ICAO → airline record
    openFlightsService.getAirlineByIcao.mockImplementation((icao) => {
      if (icao === 'BAW') return { iata: 'BA', name: 'British Airways', icao: 'BAW' };
      if (icao === 'RYR') return { iata: 'FR', name: 'Ryanair', icao: 'RYR' };
      return null;
    });
  });

  test('/aircraft/boeing-737 HTML contains anchor to /airline/ba/aircraft/b738 for BA', () => {
    const html = builders.build({
      kind: 'aircraft-airlines',
      slug: 'boeing-737',
      aircraftLabel: 'Boeing 737',
      icaoList: ['B738'],
    }, fakeDb);

    expect(html).toMatch(/<a href="\/airline\/ba\/aircraft\/b738"[^>]*>British Airways<\/a>/);
  });

  test('operator without matrix page (Ryanair) renders as plain text — no anchor', () => {
    const html = builders.build({
      kind: 'aircraft-airlines',
      slug: 'boeing-737',
      aircraftLabel: 'Boeing 737',
      icaoList: ['B738'],
    }, fakeDb);

    // Ryanair has no matrix page — must not be wrapped in <a>
    expect(html).not.toMatch(/<a [^>]*>Ryanair<\/a>/);
    // But the name must still appear as plain text in the output
    expect(html).toMatch(/Ryanair/);
  });

  test('family with multiple ICAOs links whichever ICAO has a valid combo', () => {
    // Suppose B77W is valid for BA but B772 is not
    airlineAircraftService.listValidCombinations.mockReturnValue([
      { iata: 'BA', icao_aircraft: 'B77W', n_pairs: 8 },
    ]);

    const html = builders.build({
      kind: 'aircraft-airlines',
      slug: 'boeing-777',
      aircraftLabel: 'Boeing 777',
      icaoList: ['B772', 'B77W'],
    }, fakeDb);

    expect(html).toMatch(/href="\/airline\/ba\/aircraft\/b77w"/);
  });
});

// ── Test 7: bAirline — "Top aircraft flown" section ─────────────────────────
//
// bAirline renders a "Top aircraft flown by {airline}" section with matrix-aware
// links for combos that exist, and plain text for those that don't.

describe('bAirline — Top aircraft flown section', () => {
  // Mock amadeusAnalyticsService to avoid network calls.
  beforeAll(() => {
    jest.mock('../services/amadeusAnalyticsService', () => ({
      getAirlineRoutes:            jest.fn().mockResolvedValue([]),
      getAirportDirectDestinations: jest.fn().mockResolvedValue([]),
    }));
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // getTopAircraftForAirline returns B738 (valid combo) and A320 (no combo).
    airlineAircraftService.getTopAircraftForAirline.mockReturnValue([
      { icao_aircraft: 'B738', name: 'Boeing 737', n_pairs: 12 },
      { icao_aircraft: 'A320', name: 'Airbus A320', n_pairs: 5 },
    ]);

    // Only B738 has a valid matrix page for FR.
    airlineAircraftService.listValidCombinations.mockReturnValue([
      { iata: 'FR', icao_aircraft: 'B738', n_pairs: 12 },
    ]);
  });

  test('HTML contains "Top aircraft flown" section with link to /airline/fr/aircraft/b738', async () => {
    const html = await builders.buildAsync({ kind: 'airline', iata: 'FR' }, {});
    expect(html).toMatch(/Top aircraft flown by/i);
    expect(html).toMatch(/<a href="\/airline\/fr\/aircraft\/b738"[^>]*>Boeing 737<\/a>/);
  });

  test('aircraft without a matrix page (A320) renders as plain text — no anchor', async () => {
    const html = await builders.buildAsync({ kind: 'airline', iata: 'FR' }, {});
    // A320 has no matrix page for FR — plain text, no link
    expect(html).not.toMatch(/<a [^>]*>Airbus A320<\/a>/);
    expect(html).toMatch(/Airbus A320/);
  });

  test('section absent when getTopAircraftForAirline returns empty list', async () => {
    airlineAircraftService.getTopAircraftForAirline.mockReturnValue([]);
    const html = await builders.buildAsync({ kind: 'airline', iata: 'FR' }, {});
    expect(html).not.toMatch(/Top aircraft flown/i);
  });
});

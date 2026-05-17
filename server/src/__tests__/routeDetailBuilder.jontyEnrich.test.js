'use strict';

/**
 * Task 10: Jonty enrichment of the existing /routes/:from-:to builder.
 *
 * The existing bRoute (see seoBuilders.route.enriched.test.js) emits 6
 * sections from FF's observed_routes data. This test asserts that on top
 * of whatever it emits, the builder ALSO injects a Jonty-sourced block
 * containing: km distance, duration_min, and carrier name(s).
 *
 * We mock the FF-side routeService to return null (thin pair) — proving
 * the Jonty block layers in regardless of whether the rich-route path
 * fires. Falling back to thin doesn't usually carry distance/carriers,
 * so the strings '220' / '50' / 'Aer Lingus' come strictly from Jonty.
 */

// ── Module mocks (jest hoists jest.mock to top of file) ──────────────────────
jest.mock('../models/jontyDb', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE airports (
      iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT,
      country_code TEXT, continent TEXT, latitude REAL, longitude REAL,
      elevation INTEGER, timezone TEXT, display_name TEXT
    );
    CREATE TABLE routes (
      origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER,
      PRIMARY KEY (origin_iata, dest_iata)
    );
    CREATE TABLE route_carriers (
      origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT,
      PRIMARY KEY (origin_iata, dest_iata, carrier_iata)
    );
  `);
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('ORK', 'EICK', 'Cork', 'Cork', 'Ireland', 'IE', 'EU', 51.85, -8.49, 502, 'Europe/Dublin', 'Cork (ORK), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('DUB', 'EIDW', 'Dublin', 'Dublin', 'Ireland', 'IE', 'EU', 53.42, -6.27, 242, 'Europe/Dublin', 'Dublin (DUB), Ireland');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'DUB', 220, 50);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`)
    .run('ORK', 'DUB', 'EI', 'Aer Lingus');
  return { getDb: () => db, closeDb: () => db.close() };
});

jest.mock('../services/routeService', () => ({
  getRouteData:          jest.fn(() => null),
  listValidRoutePairs:   jest.fn(() => []),
  getTopRoutesFromCity:  jest.fn(() => []),
  getTopRoutesToCity:    jest.fn(() => []),
  _resetCaches:          jest.fn(),
}));

jest.mock('../services/openFlightsService', () => ({
  getAirport:       jest.fn(() => null),
  getAirlineByIcao: jest.fn(() => null),
  isValidAirport:   jest.fn(() => true),
}));

jest.mock('../services/seoChrome', () => ({
  applyChrome:       (_meta, html) => html || '',
  applyChromeAsync:  async (_meta, html) => html || '',
}));

jest.mock('../services/fr24CacheService', () => ({ get: jest.fn(() => null) }));

jest.mock('../services/airlineAircraftService', () => ({
  listValidCombinations: jest.fn(() => []),
  buildValidComboSet:    jest.fn(() => new Set()),
}));

jest.mock('../services/aircraftRouteService', () => ({
  isQualifying:    jest.fn(() => false),
  listQualifying:  jest.fn(() => []),
}));

// ── Load builders after mocks are in place ───────────────────────────────────
const builders = require('../services/seoContentBuilders');

describe('routeDetailBuilder Jonty enrichment', () => {
  test('route page includes Jonty distance + duration + carrier', async () => {
    const html = await builders.buildAsync({
      kind:     'route',
      fromIata: 'ORK',
      toIata:   'DUB',
      fromName: 'Cork',
      toName:   'Dublin',
      pair:     'ork-dub',
    });
    expect(html).toBeTruthy();
    expect(html).toContain('220');         // km
    expect(html).toContain('50');          // duration
    expect(html).toContain('Aer Lingus');  // carrier
  });

  test('falls back gracefully if Jonty has no row for this route', async () => {
    // ORK/ZZZ does not exist in our fixture — Jonty section is omitted, but
    // the rest of the existing thin/rich template must still render without
    // throwing.
    const html = await builders.buildAsync({
      kind:     'route',
      fromIata: 'ORK',
      toIata:   'ZZZ',
      fromName: 'Cork',
      toName:   'Unknown',
      pair:     'ork-zzz',
    });
    // ZZZ isn't in jonty fixture → Jonty section must NOT render
    // The page should still render (existing thin/rich template) and not throw
    expect(typeof html === 'string' || html === null).toBe(true);
    if (typeof html === 'string') {
      expect(html).not.toContain('Operating airlines');
      expect(html).not.toContain('route-jonty');
    }
  });
});

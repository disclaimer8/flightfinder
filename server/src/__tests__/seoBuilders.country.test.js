'use strict';
const Database = require('better-sqlite3');

function newJontyDb() {
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`);
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('JFK', 'KJFK', 'JFK', 'New York', 'USA', 'US', 'NA', 40.64, -73.78, 13, 'America/New_York', 'New York (JFK)');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LAX', 'KLAX', 'LAX', 'Los Angeles', 'USA', 'US', 'NA', 33.94, -118.41, 38, 'America/Los_Angeles', 'Los Angeles (LAX)');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('JFK', 'LAX', 'AA', 'American');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('JFK', 'LAX', 'DL', 'Delta');
  // Reverse route so LAX also appears in topAirports (otherwise only origin
  // airports show up); needed by M5 test that asserts city-name fallback on LAX.
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('LAX', 'JFK', 'AA', 'American');
  return db;
}

let meta, builders;
beforeAll(() => {
  jest.resetModules();
  const db = newJontyDb();
  jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
  meta = require('../services/seoMetaService');
  builders = require('../services/seoContentBuilders');
});

describe('country — /country/:cc', () => {
  test('resolver returns kind=country with name from Intl.DisplayNames', () => {
    const m = meta.resolve('/country/US');
    expect(m).toBeTruthy();
    expect(m.kind).toBe('country');
    expect(m.cc).toBe('US');
    expect(m.title).toMatch(/United States/);
    expect(m.h1).toMatch(/United States/);
  });

  test('builder produces inner <main> HTML with top airports list (city names)', async () => {
    const m = meta.resolve('/country/US');
    const html = await builders.buildAsync(m, {});
    expect(html).toMatch(/<main>/);
    expect(html).not.toMatch(/<title>/); // shell contract
    // Verify the builder uses city || iata fallback — city should win
    expect(html).toMatch(/New York/);
    expect(html).toMatch(/Los Angeles/);
    expect(html).toMatch(/JFK/); // IATA still appears in parens
    expect(html).toMatch(/LAX/);
  });

  test('schema includes Place + BreadcrumbList + FAQPage (NOT Country type)', async () => {
    const m = meta.resolve('/country/US');
    const html = await builders.buildAsync(m, {});
    expect(html).toMatch(/"@type"\s*:\s*"Place"/);
    expect(html).not.toMatch(/"@type"\s*:\s*"Country"/);
    expect(html).toMatch(/"@type"\s*:\s*"BreadcrumbList"/);
    expect(html).toMatch(/"@type"\s*:\s*"FAQPage"/);
  });

  test('resolver returns null/not-found for country with no airports', () => {
    // Spam-prevention: codes without jonty airports must not produce
    // resolver-level meta that could leak into shell SSR.
    const m1 = meta.resolve('/country/ZZ');
    expect(m1 === null || m1.kind === 'not-found').toBe(true);

    const m2 = meta.resolve('/country/AQ'); // valid ISO, but no airports in fixture
    expect(m2 === null || m2.kind === 'not-found').toBe(true);
  });

  test('isLazyPath matches /country/:cc', () => {
    const cache = require('../services/seoContentCache');
    expect(cache.isLazyPath('/country/US')).toBe(true);
    expect(cache.isLazyPath('/country/DE')).toBe(true);
    expect(cache.isLazyPath('/country/usa')).toBe(false); // 3 chars not allowed
    expect(cache.isLazyPath('/country/')).toBe(false);
  });
});

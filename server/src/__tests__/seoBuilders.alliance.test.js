'use strict';
const Database = require('better-sqlite3');

function newJontyDb() {
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`);
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('FRA', 'EDDF', 'Frankfurt', 'Frankfurt', 'Germany', 'DE', 'EU', 50.03, 8.55, 364, 'Europe/Berlin', 'Frankfurt (FRA)');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('JFK', 'KJFK', 'JFK', 'New York', 'USA', 'US', 'NA', 40.64, -73.78, 13, 'America/New_York', 'New York (JFK)');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('FRA', 'JFK', 6191, 510);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('FRA', 'JFK', 'LH', 'Lufthansa');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('FRA', 'JFK', 'UA', 'United');
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

describe('alliance — /alliance/:slug', () => {
  test('resolver returns kind=alliance for known slug', () => {
    const m = meta.resolve('/alliance/star-alliance');
    expect(m).toBeTruthy();
    expect(m.kind).toBe('alliance');
    expect(m.slug).toBe('star-alliance');
    expect(m.title).toMatch(/Star Alliance/);
    expect(m.h1).toMatch(/Star Alliance/);
    expect(m.robots).toMatch(/index/);
  });

  test('resolver returns null/not-found for unknown slug', () => {
    const m = meta.resolve('/alliance/bogus');
    expect(m === null || m.kind === 'not-found').toBe(true);
  });

  test('builder produces inner <main> HTML with member list', async () => {
    const m = meta.resolve('/alliance/star-alliance');
    const html = await builders.buildAsync(m, {});
    expect(html).toMatch(/<main>/);
    expect(html).not.toMatch(/<title>/); // shell contract: no head/title in builder
    expect(html).toMatch(/Lufthansa|LH/);
  });

  test('schema includes Organization + BreadcrumbList + FAQPage', async () => {
    const m = meta.resolve('/alliance/star-alliance');
    const html = await builders.buildAsync(m, {});
    expect(html).toMatch(/"@type"\s*:\s*"Organization"/);
    expect(html).toMatch(/"@type"\s*:\s*"BreadcrumbList"/);
    expect(html).toMatch(/"@type"\s*:\s*"FAQPage"/);
  });

  test('isLazyPath matches /alliance/:slug', () => {
    const cache = require('../services/seoContentCache');
    expect(cache.isLazyPath('/alliance/star-alliance')).toBe(true);
    expect(cache.isLazyPath('/alliance/oneworld')).toBe(true);
    expect(cache.isLazyPath('/alliance/skyteam')).toBe(true);
    expect(cache.isLazyPath('/alliance/')).toBe(false);
  });
});

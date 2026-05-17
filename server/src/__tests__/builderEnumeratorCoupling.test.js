'use strict';
const Database = require('better-sqlite3');

function newDb() {
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`);
  // Фикстура: 3 airport, 3 route, 3 carrier-row
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('ORK', 'EICK', 'Cork', 'Cork', 'Ireland', 'IE', 'EU', 51.85, -8.49, 502, 'Europe/Dublin', 'Cork (ORK), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('DUB', 'EIDW', 'Dublin', 'Dublin', 'Ireland', 'IE', 'EU', 53.42, -6.27, 242, 'Europe/Dublin', 'Dublin (DUB), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LHR', 'EGLL', 'Heathrow', 'London', 'United Kingdom', 'GB', 'EU', 51.47, -0.45, 80, 'Europe/London', 'London (LHR), United Kingdom');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'LHR', 557, 78);
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('DUB', 'LHR', 463, 75);
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'DUB', 220, 50);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'LHR', 'EI', 'Aer Lingus');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('DUB', 'LHR', 'EI', 'Aer Lingus');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'DUB', 'FR', 'Ryanair');
  return db;
}

let enumerator, builders, meta;
beforeAll(() => {
  jest.resetModules();
  const db = newDb();
  jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
  enumerator = require('../services/seoUrlEnumerator');
  builders = require('../services/seoContentBuilders');
  meta = require('../services/seoMetaService');
});

describe('builder↔enumerator coupling — every enumerated URL must resolve and build', () => {
  it.each([
    ['airport landings', () => enumerator.enumerateAirportLandingUrls()],
    ['airline networks', () => enumerator.enumerateAirlineNetworkUrls()],
    ['airline×airport', () => enumerator.enumerateAirlineAirportUrls()],
  ])('%s', async (_label, getUrls) => {
    const urls = getUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls.slice(0, 5)) { // sample first 5 per family
      const m = meta.resolve(url);
      expect(m).toBeTruthy();
      const html = await builders.buildAsync(m);
      expect(html).toBeTruthy();
      expect(html.length).toBeGreaterThan(200);
    }
  });
});

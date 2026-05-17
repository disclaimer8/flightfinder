'use strict';

// Phase 1 dispatch tests: confirm buildAsync routes new kinds to the right
// standalone builders, and that /airline/:iata uses jonty-vs-bAirline coexistence.

const Database = require('better-sqlite3');

function newJontyDb({ withEI = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`);
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('ORK', 'EICK', 'Cork', 'Cork', 'Ireland', 'IE', 'EU', 51.85, -8.49, 502, 'Europe/Dublin', 'Cork (ORK), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LHR', 'EGLL', 'Heathrow', 'London', 'United Kingdom', 'GB', 'EU', 51.47, -0.45, 80, 'Europe/London', 'London (LHR), United Kingdom');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'LHR', 557, 78);
  if (withEI) {
    db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'LHR', 'EI', 'Aer Lingus');
  }
  return db;
}

describe('seoContentBuilders.buildAsync — Phase 1 dispatch', () => {
  let builders;
  beforeAll(() => {
    jest.resetModules();
    const db = newJontyDb({ withEI: true });
    jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
    builders = require('../services/seoContentBuilders');
  });

  it('airport-departures → airportLandingBuilder.buildDepartures', async () => {
    const html = await builders.buildAsync({ kind: 'airport-departures', iata: 'ORK' });
    expect(html).toBeTruthy();
    expect(html).toContain('<h1>Flights from Cork (ORK)');
    expect(html).toContain('<link rel="canonical" href="https://himaxym.com/flights-from/ORK">');
  });

  it('airport-arrivals → airportLandingBuilder.buildArrivals', async () => {
    const html = await builders.buildAsync({ kind: 'airport-arrivals', iata: 'LHR' });
    expect(html).toBeTruthy();
    expect(html).toContain('<h1>Flights to London Heathrow (LHR)');
    expect(html).toContain('<link rel="canonical" href="https://himaxym.com/flights-to/LHR">');
  });

  it('airline-airport → airlineAirportBuilder.build', async () => {
    const html = await builders.buildAsync({ kind: 'airline-airport', airlineIata: 'EI', airportIata: 'ORK' });
    expect(html).toBeTruthy();
    expect(html).toContain('<h1>Aer Lingus flights from Cork (ORK)</h1>');
    expect(html).toContain('<link rel="canonical" href="https://himaxym.com/airline/EI/from/ORK">');
  });

  it('returns null when builder produces no result (unknown IATA)', async () => {
    const html = await builders.buildAsync({ kind: 'airport-departures', iata: 'ZZZ' });
    expect(html).toBeNull();
  });
});

describe('seoContentBuilders.buildAsync — /airline/:iata coexistence', () => {
  let buildersWithJonty;
  beforeAll(() => {
    jest.resetModules();
    const db = newJontyDb({ withEI: true });
    jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
    buildersWithJonty = require('../services/seoContentBuilders');
  });

  it('kind:airline + jonty has data → renders airlineNetworkBuilder output', async () => {
    const html = await buildersWithJonty.buildAsync({ kind: 'airline', iata: 'EI' }, {});
    expect(html).toBeTruthy();
    // The new builder produces an H1 like "Aer Lingus (EI) route network".
    // The old bAirline produces "EI — destinations and fleet" or similar.
    // This assertion specifically pins the NEW path.
    expect(html).toContain('route network</h1>');
  });

  it('kind:airline + jonty has NO data for this carrier → falls back to bAirline', async () => {
    jest.resetModules();
    const db = newJontyDb({ withEI: false }); // no route_carriers rows
    jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
    const buildersNoEi = require('../services/seoContentBuilders');
    const html = await buildersNoEi.buildAsync({ kind: 'airline', iata: 'EI' }, {});
    // bAirline returns innerHtml wrapped via applyChromeAsync — may return null or a
    // chrome-wrapped page (depends on amadeus availability in test env). The contract
    // here is: it should NOT contain the new builder's marker.
    if (html !== null) {
      expect(html).not.toContain('route network</h1>');
    }
  });
});

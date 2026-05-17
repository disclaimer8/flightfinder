'use strict';
const Database = require('better-sqlite3');
const SCHEMA = `
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`;

function newDbWithFixture() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'ORK', 'EICK', 'Cork', 'Cork', 'Ireland', 'IE', 'EU', 51.85, -8.49, 502, 'Europe/Dublin', 'Cork (ORK), Ireland'
  );
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'LHR', 'EGLL', 'Heathrow', 'London', 'United Kingdom', 'GB', 'EU', 51.47, -0.45, 80, 'Europe/London', 'London (LHR), United Kingdom'
  );
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'AMS', 'EHAM', 'Schiphol', 'Amsterdam', 'Netherlands', 'NL', 'EU', 52.31, 4.76, -11, 'Europe/Amsterdam', 'Amsterdam (AMS), Netherlands'
  );
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'LHR', 557, 78);
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'AMS', 908, 105);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'LHR', 'EI', 'Aer Lingus');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'AMS', 'KL', 'KLM');
  return db;
}

let builder;
beforeAll(() => {
  jest.resetModules();
  const db = newDbWithFixture();
  jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
  builder = require('../services/airportLandingBuilder');
});

describe('airportLandingBuilder.buildDepartures', () => {
  it('returns HTML with H1 and destination list', () => {
    const html = builder.buildDepartures('ORK');
    expect(html).toContain('<h1>Flights from Cork (ORK)');
    expect(html).toMatch(/<strong>2<\/strong>\s*non-stop destinations/);
    expect(html).toContain('London');
    expect(html).toContain('Amsterdam');
  });

  it('embeds Airport + BreadcrumbList + FAQPage JSON-LD', () => {
    const html = builder.buildDepartures('ORK');
    expect(html).toMatch(/"@type":\s*"Airport"/);
    expect(html).toMatch(/"@type":\s*"BreadcrumbList"/);
    expect(html).toMatch(/"@type":\s*"FAQPage"/);
  });

  it('contains canonical + author link', () => {
    const html = builder.buildDepartures('ORK');
    expect(html).toContain('<link rel="canonical" href="https://himaxym.com/flights-from/ORK">');
    expect(html).toContain('/about/team');
  });

  it('renders aircraft placeholder (P1)', () => {
    const html = builder.buildDepartures('ORK');
    expect(html).toContain('Aircraft assignments');
    expect(html).toContain('/by-aircraft');
  });

  it('returns null for unknown IATA', () => {
    expect(builder.buildDepartures('ZZZ')).toBeNull();
  });
});

describe('airportLandingBuilder.buildArrivals', () => {
  it('lists routes inbound TO the airport', () => {
    const html = builder.buildArrivals('LHR');
    expect(html).toContain('<h1>Flights to London Heathrow (LHR)');
    expect(html).toContain('Cork');
  });

  it('canonical points to /flights-to/', () => {
    const html = builder.buildArrivals('LHR');
    expect(html).toContain('<link rel="canonical" href="https://himaxym.com/flights-to/LHR">');
  });
});

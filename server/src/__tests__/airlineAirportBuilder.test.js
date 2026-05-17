'use strict';
const Database = require('better-sqlite3');

function newDb() {
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`);
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('ORK', 'EICK', 'Cork', 'Cork', 'Ireland', 'IE', 'EU', 51.85, -8.49, 502, 'Europe/Dublin', 'Cork (ORK), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LHR', 'EGLL', 'Heathrow', 'London', 'United Kingdom', 'GB', 'EU', 51.47, -0.45, 80, 'Europe/London', 'London (LHR), United Kingdom');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('FAO', 'LPFR', 'Faro', 'Faro', 'Portugal', 'PT', 'EU', 37.01, -7.97, 24, 'Europe/Lisbon', 'Faro (FAO), Portugal');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'LHR', 557, 78);
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'FAO', 1648, 155);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'LHR', 'EI', 'Aer Lingus');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'FAO', 'EI', 'Aer Lingus');
  return db;
}

let builder;
beforeAll(() => {
  jest.resetModules();
  const db = newDb();
  jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
  builder = require('../services/airlineAirportBuilder');
});

// After P1 inner-HTML refactor + double-h1 fix: builder returns only
// <main>...</main> WITHOUT an <h1>; shell + seoMetaService.inject()
// (airlineAirportMeta) supply doctype/title/canonical AND the <h1>.
describe('airlineAirportBuilder.build', () => {
  it('returns inner <main> HTML listing EI routes from ORK only with no <h1>', () => {
    const html = builder.build('EI', 'ORK');
    expect(html).toMatch(/^<main>/);
    expect(html).toContain('</main>');
    expect(html).not.toMatch(/<!doctype/i);
    expect(html).not.toMatch(/<\/?html\b/i);
    expect(html).not.toMatch(/<\/?head\b/i);
    expect(html).not.toMatch(/<h1\b/);
    // Carrier name + origin city still appear in intro/destinations sections.
    expect(html).toContain('Aer Lingus');
    expect(html).toContain('Cork');
    expect(html).toContain('London');
    expect(html).toContain('Faro');
  });

  it('embeds BreadcrumbList + FAQPage JSON-LD inside <main>', () => {
    const html = builder.build('EI', 'ORK');
    expect(html).toMatch(/"@type":\s*"BreadcrumbList"/);
    expect(html).toMatch(/"@type":\s*"FAQPage"/);
    expect(html.indexOf('<script type="application/ld+json">')).toBeGreaterThan(html.indexOf('<main>'));
  });

  it('returns null when carrier has no routes from airport', () => {
    expect(builder.build('FR', 'ORK')).toBeNull();
  });
});

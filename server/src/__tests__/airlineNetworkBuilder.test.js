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
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('DUB', 'EIDW', 'Dublin', 'Dublin', 'Ireland', 'IE', 'EU', 53.42, -6.27, 242, 'Europe/Dublin', 'Dublin (DUB), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LHR', 'EGLL', 'Heathrow', 'London', 'United Kingdom', 'GB', 'EU', 51.47, -0.45, 80, 'Europe/London', 'London (LHR), United Kingdom');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'LHR', 557, 78);
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('DUB', 'LHR', 463, 75);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'LHR', 'EI', 'Aer Lingus');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('DUB', 'LHR', 'EI', 'Aer Lingus');
  return db;
}

let builder;
beforeAll(() => {
  jest.resetModules();
  const db = newDb();
  jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
  builder = require('../services/airlineNetworkBuilder');
});

// After P1 inner-HTML refactor + double-h1 fix: builder returns only
// <main>...</main> WITHOUT an <h1>. Shell + seoMetaService.inject()
// (airlineMeta for kind:'airline' coexistence) supply doctype/title/canonical/
// robots AND the <h1> from airlineMeta.h1.
describe('airlineNetworkBuilder.build', () => {
  it('returns inner <main> HTML with airline name, route count, country count and no <h1>', () => {
    const html = builder.build('EI');
    expect(html).toMatch(/^<main>/);
    expect(html).toContain('</main>');
    expect(html).not.toMatch(/<!doctype/i);
    expect(html).not.toMatch(/<\/?html\b/i);
    expect(html).not.toMatch(/<\/?head\b/i);
    expect(html).not.toMatch(/<h1\b/);
    // Carrier name still appears in intro / FAQ / origin links.
    expect(html).toContain('Aer Lingus');
    expect(html).toMatch(/<strong>2<\/strong>\s*non-stop route/);
    expect(html).toMatch(/<strong>2<\/strong>\s*countr/);  // matches 'countries' or 'country'
  });

  it('lists origin airports with route counts', () => {
    const html = builder.build('EI');
    expect(html).toContain('Cork');
    expect(html).toContain('Dublin');
  });

  it('embeds BreadcrumbList + FAQPage JSON-LD inside <main>', () => {
    const html = builder.build('EI');
    expect(html).toMatch(/"@type":\s*"BreadcrumbList"/);
    expect(html).toMatch(/"@type":\s*"FAQPage"/);
    expect(html.indexOf('<script type="application/ld+json">')).toBeGreaterThan(html.indexOf('<main>'));
  });

  it('returns null for airline with no routes', () => {
    expect(builder.build('XX')).toBeNull();
  });
});

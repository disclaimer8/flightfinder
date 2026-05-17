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

// After P1 inner-HTML refactor: builder returns only <main>...</main>. The
// surrounding <!doctype>/<html>/<head>/<title>/<link rel=canonical>/<meta robots>
// are emitted by the React shell + seoMetaService.inject() at request time.
// Tests assert the inner-HTML contract: H1, JSON-LD inside main, intro/route
// rows, aircraft placeholder, author link, null-on-miss.
describe('airportLandingBuilder.buildDepartures', () => {
  it('returns inner <main> HTML with H1 and destination list', () => {
    const html = builder.buildDepartures('ORK');
    expect(html).toMatch(/^<main>/);
    expect(html).toContain('</main>');
    expect(html).not.toMatch(/<!doctype/i);
    expect(html).not.toMatch(/<\/?html\b/i);
    expect(html).not.toMatch(/<\/?head\b/i);
    expect(html).toContain('<h1>Flights from Cork (ORK)');
    expect(html).toMatch(/<strong>2<\/strong>\s*non-stop destinations/);
    expect(html).toContain('London');
    expect(html).toContain('Amsterdam');
  });

  it('embeds Airport + BreadcrumbList + FAQPage JSON-LD inside <main>', () => {
    const html = builder.buildDepartures('ORK');
    expect(html).toMatch(/"@type":\s*"Airport"/);
    expect(html).toMatch(/"@type":\s*"BreadcrumbList"/);
    expect(html).toMatch(/"@type":\s*"FAQPage"/);
    // JSON-LD must live INSIDE the <main> fragment (Google parses JSON-LD
    // anywhere) — the shell's <head> has no JSON-LD slot for this kind.
    const ld = html.match(/<script type="application\/ld\+json">/);
    expect(ld).not.toBeNull();
    expect(html.indexOf('<script type="application/ld+json">')).toBeGreaterThan(html.indexOf('<main>'));
  });

  it('contains author/methodology link in footer', () => {
    const html = builder.buildDepartures('ORK');
    expect(html).toContain('/about/team');
    expect(html).toContain('/methodology');
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
  it('returns inner <main> HTML with routes inbound TO the airport', () => {
    const html = builder.buildArrivals('LHR');
    expect(html).toMatch(/^<main>/);
    expect(html).not.toMatch(/<!doctype/i);
    expect(html).toContain('<h1>Flights to London Heathrow (LHR)');
    expect(html).toContain('Cork');
  });

  it('does not duplicate city when name equals city (e.g., Cork)', () => {
    const html = builder.buildArrivals('ORK');
    // ORK fixture: city='Cork', name='Cork'
    expect(html).toContain('<h1>Flights to Cork (ORK)');
    expect(html).not.toContain('Cork Cork');
  });
});

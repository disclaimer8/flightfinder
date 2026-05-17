'use strict';
// Verifies sitemap.xml includes the Phase 1 SEO family URLs.

const Database = require('better-sqlite3');

function newJontyDb() {
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`);
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('ORK', 'EICK', 'Cork', 'Cork', 'Ireland', 'IE', 'EU', 51.85, -8.49, 502, 'Europe/Dublin', 'Cork (ORK), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LHR', 'EGLL', 'Heathrow', 'London', 'United Kingdom', 'GB', 'EU', 51.47, -0.45, 80, 'Europe/London', 'London (LHR), United Kingdom');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'LHR', 557, 78);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'LHR', 'EI', 'Aer Lingus');
  return db;
}

let app;
beforeAll(() => {
  // Fixture uses ORK/LHR — ORK isn't in the top-50 hub allowlist, so we
  // force 'all' to keep these sitemap-inclusion assertions valid.
  process.env.FF_SEO_P1_STAGE = 'all';
  jest.resetModules();
  const db = newJontyDb();
  jest.doMock('../models/jontyDb', () => ({ getDb: () => db, closeDb: () => db.close() }));
  app = require('../index');
});

afterAll(() => {
  delete process.env.FF_SEO_P1_STAGE;
});

const request = require('supertest');

describe('sitemap.xml — P1 family inclusion', () => {
  it('contains /flights-from/:iata entries', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]*\/flights-from\/(?:ork|lhr)<\/loc>/i);
  });

  it('contains /flights-to/:iata entries', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]*\/flights-to\/(?:ork|lhr)<\/loc>/i);
  });

  it('contains /airline/:iata/from/:airport entries', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]*\/airline\/ei\/from\/ork<\/loc>/i);
  });

  it('does not duplicate /airline/:iata when present from multiple sources', async () => {
    const res = await request(app).get('/sitemap.xml');
    const matches = res.text.match(/<loc>https?:\/\/[^<]*\/airline\/ei<\/loc>/gi) || [];
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});

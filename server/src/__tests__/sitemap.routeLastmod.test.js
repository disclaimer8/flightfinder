// Verify the routes sitemap surfaces a real per-pair `lastmod` from
// observed_routes.seen_at, not a uniform "today" timestamp.

const dbMod = require('../models/db');

jest.mock('../services/seoUrlEnumerator', () => ({
  enumerateSeoUrls: () => [
    '/',
    '/routes/lhr-jfk',
    '/routes/jfk-lhr',
    '/routes/qqq-zzz',   // pair with no observed_routes rows → falls back to today
  ],
  STATIC_PATHS: ['/'],
}));

const express = require('express');
const request = require('supertest');
const seoRouter = require('../routes/seo');

const app = express().use('/', seoRouter);

describe('routes lastmod from observed_routes', () => {
  // 30 days back, plenty before today, so we can distinguish from today's value.
  const OLD_EPOCH = Date.now() - 30 * 24 * 3600 * 1000;
  const OLD_ISO   = new Date(OLD_EPOCH).toISOString().slice(0, 10);
  const TODAY_ISO = new Date().toISOString().slice(0, 10);

  beforeAll(() => {
    dbMod.db.exec('DELETE FROM observed_routes');
    const ins = dbMod.db.prepare(`
      INSERT OR REPLACE INTO observed_routes
        (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    ins.run('LHR', 'JFK', 'B77W', 'BAW', OLD_EPOCH, OLD_EPOCH, 'test');
    ins.run('JFK', 'LHR', 'B77W', 'BAW', OLD_EPOCH, OLD_EPOCH, 'test');
  });

  it('uses observed_routes max(seen_at) for /routes/{a}-{b}', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    const m = res.text.match(
      /<loc>https:\/\/himaxym\.com\/routes\/lhr-jfk<\/loc>\s*<lastmod>([0-9-]+)<\/lastmod>/,
    );
    expect(m).not.toBeNull();
    expect(m[1]).toBe(OLD_ISO);
  });

  it('falls back to today for pairs not in observed_routes', async () => {
    const res = await request(app).get('/sitemap.xml');
    const m = res.text.match(
      /<loc>https:\/\/himaxym\.com\/routes\/qqq-zzz<\/loc>\s*<lastmod>([0-9-]+)<\/lastmod>/,
    );
    expect(m).not.toBeNull();
    expect(m[1]).toBe(TODAY_ISO);
  });
});

describe('getRouteLastSeenMap helper', () => {
  beforeAll(() => {
    dbMod.db.exec('DELETE FROM observed_routes');
    const ins = dbMod.db.prepare(`
      INSERT INTO observed_routes
        (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    // Two aircraft observations for the same pair — should pick the MAX.
    ins.run('AAA', 'BBB', 'A20N', 'XXX', 1000, 1000, 'test');
    ins.run('AAA', 'BBB', 'B738', 'YYY', 5000, 5000, 'test');
    // Different pair.
    ins.run('CCC', 'DDD', 'A332', 'ZZZ', 3000, 3000, 'test');
  });

  it('returns max seen_at per directional pair', () => {
    const map = dbMod.getRouteLastSeenMap();
    expect(map.get('AAA-BBB')).toBe(5000);
    expect(map.get('CCC-DDD')).toBe(3000);
    expect(map.get('XXX-YYY')).toBeUndefined();
  });
});

// server/src/__tests__/seoContentBuilders.test.js
const { build } = require('../services/seoContentBuilders');

describe('seoContentBuilders.build — static kinds', () => {
  it('returns null for unknown kind', () => {
    expect(build({ kind: 'never-heard-of-this' })).toBeNull();
  });

  it('returns HTML containing pricing tier names for kind=pricing', () => {
    const html = build({ kind: 'pricing' });
    expect(html).toMatch(/Pro Monthly|monthly/i);
    expect(html).toMatch(/Pro Annual|annual|yearly/i);
  });

  it('returns HTML mentioning the team for kind=about', () => {
    const html = build({ kind: 'about' });
    expect(html).toMatch(/<p>/);
    expect(html.length).toBeGreaterThan(200);
  });

  it('returns HTML describing the map for kind=map', () => {
    const html = build({ kind: 'map' });
    expect(html).toMatch(/airport|route|map/i);
  });

  it('returns HTML listing aircraft families for kind=by-aircraft', () => {
    const html = build({ kind: 'by-aircraft' });
    expect(html).toMatch(/<li>/);
  });
});

describe('seoContentBuilders.build — route', () => {
  beforeAll(() => {
    const db = require('../models/db');
    function seed(dep, arr, icao, airline) {
      db.upsertObservedRoute({
        depIata: dep, arrIata: arr, aircraftIcao: icao, airlineIata: airline, source: 'test',
      });
    }
    // 3 distinct (dep,arr,icao) tuples on LHR-JFK -> 3 airlines, 3 aircraft
    seed('LHR', 'JFK', 'B77W', 'BA');
    seed('LHR', 'JFK', 'A359', 'AA');
    seed('LHR', 'JFK', 'B789', 'VS');
  });

  it('returns HTML mentioning airline count and aircraft for a route', () => {
    const { build } = require('../services/seoContentBuilders');
    const meta = {
      kind: 'route',
      fromIata: 'LHR', toIata: 'JFK',
      fromName: 'London Heathrow', toName: 'John F Kennedy',
    };
    const html = build(meta);
    expect(html).toMatch(/airline/i);
    expect(html).toMatch(/B77W|A359|B789/);
  });

  it('returns null for a route with no observed flights', () => {
    const { build } = require('../services/seoContentBuilders');
    const meta = {
      kind: 'route',
      fromIata: 'AAA', toIata: 'BBB',
      fromName: 'X', toName: 'Y',
    };
    expect(build(meta)).toBeNull();
  });
});

describe('seoContentBuilders.build — aircraft + aircraft-specs', () => {
  beforeAll(() => {
    const db = require('../models/db');
    function seed(dep, arr, icao, airline) {
      db.upsertObservedRoute({
        depIata: dep, arrIata: arr, aircraftIcao: icao, airlineIata: airline, source: 'test',
      });
    }
    seed('JFK', 'LHR', 'B77W', 'BA');
    seed('LAX', 'NRT', 'B77W', 'JL');
  });

  it('returns HTML mentioning operator count and a top route for kind=aircraft', () => {
    const { build } = require('../services/seoContentBuilders');
    const meta = {
      kind: 'aircraft',
      slug: 'boeing-777',
      aircraftLabel: 'Boeing 777',
      icaoList: ['B77W'],
    };
    const html = build(meta);
    expect(html).toMatch(/airline/i);
    expect(html).toMatch(/Boeing 777|B77W/);
  });

  it('returns HTML with specs for kind=aircraft-specs', () => {
    const { build } = require('../services/seoContentBuilders');
    const meta = {
      kind: 'aircraft-specs',
      aircraftLabel: 'Boeing 777',
      slug: 'boeing-777',
      icaoList: ['B77W'],
      family: { range_km: 14490, capacity: '301-368', engines: '2 × GE90', mtow_kg: 351500 },
    };
    const html = build(meta);
    expect(html).toMatch(/14490|range/i);
  });

  it('returns null for aircraft with no icaoList', () => {
    const { build } = require('../services/seoContentBuilders');
    expect(build({ kind: 'aircraft', aircraftLabel: 'X' })).toBeNull();
  });
});

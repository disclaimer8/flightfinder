'use strict';
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT, city TEXT, country TEXT, country_code TEXT, continent TEXT, latitude REAL, longitude REAL, elevation INTEGER, timezone TEXT, display_name TEXT);
CREATE TABLE routes (origin_iata TEXT, dest_iata TEXT, km INTEGER, duration_min INTEGER, PRIMARY KEY (origin_iata, dest_iata));
CREATE TABLE route_carriers (origin_iata TEXT, dest_iata TEXT, carrier_iata TEXT, carrier_name TEXT, PRIMARY KEY (origin_iata, dest_iata, carrier_iata));
`;

function newDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seed(db) {
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('ORK', 'EICK', 'Cork', 'Cork', 'Ireland', 'IE', 'EU', 51.85, -8.49, 502, 'Europe/Dublin', 'Cork (ORK), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('DUB', 'EIDW', 'Dublin Airport', 'Dublin', 'Ireland', 'IE', 'EU', 53.42, -6.27, 242, 'Europe/Dublin', 'Dublin (DUB), Ireland');
  db.prepare(`INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('LHR', 'EGLL', 'Heathrow', 'London', 'United Kingdom', 'GB', 'EU', 51.47, -0.45, 80, 'Europe/London', 'London (LHR), United Kingdom');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'LHR', 557, 78);
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('ORK', 'AMS', 908, 105);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'LHR', 'EI', 'Aer Lingus');
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('ORK', 'AMS', 'KL', 'KLM');
  db.prepare(`INSERT INTO routes VALUES (?,?,?,?)`).run('LHR', 'ORK', 557, 80);
  db.prepare(`INSERT INTO route_carriers VALUES (?,?,?,?)`).run('LHR', 'ORK', 'EI', 'Aer Lingus');
  return db;
}

let svc;
beforeAll(() => {
  jest.resetModules();
  jest.doMock('../models/jontyDb', () => {
    const db = seed(newDb());
    return { getDb: () => db, closeDb: () => db.close() };
  });
  svc = require('../services/jontyRouteService');
});

describe('jontyRouteService', () => {
  it('getAirportMeta returns metadata', () => {
    const m = svc.getAirportMeta('ORK');
    expect(m.iata).toBe('ORK');
    expect(m.city).toBe('Cork');
    expect(m.country).toBe('Ireland');
    expect(m.latitude).toBe(51.85);
  });

  it('getAirportMeta unknown returns null', () => {
    expect(svc.getAirportMeta('ZZZ')).toBeNull();
  });

  it('getDeparturesFromAirport groups by route with carriers + dest metadata', () => {
    const rows = svc.getDeparturesFromAirport('ORK');
    expect(rows).toHaveLength(2);
    const lhr = rows.find(r => r.dest_iata === 'LHR');
    expect(lhr.dest_city).toBe('London');
    expect(lhr.carriers).toEqual([{ iata: 'EI', name: 'Aer Lingus' }]);
    expect(lhr.km).toBe(557);
  });

  it('getArrivalsToAirport returns inbound routes', () => {
    const rows = svc.getArrivalsToAirport('ORK');
    expect(rows).toHaveLength(1);
    expect(rows[0].origin_iata).toBe('LHR');
  });

  it('getAirlineNetwork lists all routes for a carrier with origin+dest metadata', () => {
    const network = svc.getAirlineNetwork('EI');
    expect(network).toHaveLength(2);
    const ork_lhr = network.find(r => r.origin_iata === 'ORK' && r.dest_iata === 'LHR');
    expect(ork_lhr).toBeDefined();
    expect(ork_lhr.origin_city).toBe('Cork');
    expect(ork_lhr.dest_city).toBe('London');
  });

  it('getAirlinesFromAirport returns distinct airlines with route counts', () => {
    const airlines = svc.getAirlinesFromAirport('ORK');
    expect(airlines).toContainEqual({ iata: 'EI', name: 'Aer Lingus', route_count: 1 });
    expect(airlines).toContainEqual({ iata: 'KL', name: 'KLM', route_count: 1 });
  });

  it('listAirportsByCountry returns iata + name sorted', () => {
    const rows = svc.listAirportsByCountry('IE');
    expect(rows.map(r => r.iata).sort()).toEqual(['DUB', 'ORK']);
  });
});

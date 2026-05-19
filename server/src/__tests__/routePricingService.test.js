'use strict';

jest.mock('../services/openFlightsService', () => ({
  getAirlineByIcao: jest.fn((icao) => {
    const m = { BAW: { iata: 'BA', name: 'British Airways' }, AAL: { iata: 'AA', name: 'American Airlines' } };
    return m[icao] || null;
  }),
  getAirport: jest.fn((iata) => ({ iata, name: iata + ' Airport', city: iata })),
}));

jest.mock('../models/aircraftFamilies', () => ({
  getFamilyByCode: jest.fn((icao) => ({
    code: icao, label: icao === 'B789' ? 'Boeing 787-9' : icao,
  })),
  slugify: jest.fn((label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
}));

jest.mock('../services/aircraftSafetyService', () => ({
  getMergedEventsForFamily: jest.fn(() => []),
}));

const { db } = require('../models/db');
const cacheService = require('../services/cacheService');
const svc = require('../services/routePricingService');

beforeEach(() => {
  db.exec(`DELETE FROM route_aircraft_prices`);
  cacheService.flush();
});

describe('getPricesForRoute', () => {
  it('returns empty array when no data', () => {
    expect(svc.getPricesForRoute('LHR', 'JFK')).toEqual([]);
  });

  it('returns enriched rows sorted by median_eur ASC', () => {
    db.prepare(`INSERT INTO route_aircraft_prices VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('LHR', 'JFK', 'A388', 700, 600, 800, 5, 'BAW', Date.now());
    db.prepare(`INSERT INTO route_aircraft_prices VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('LHR', 'JFK', 'B789', 500, 400, 600, 8, 'BAW,AAL', Date.now());

    const out = svc.getPricesForRoute('lhr', 'jfk');
    expect(out).toHaveLength(2);
    expect(out[0].aircraft_icao).toBe('B789');
    expect(out[0].aircraft_name).toBe('Boeing 787-9');
    expect(out[0].aircraft_slug).toBe('boeing-787-9');
    expect(out[0].median_eur).toBe(500);
    expect(out[0].airlines).toEqual(['BAW', 'AAL']);
    expect(out[0].airlines_display).toBe('British Airways, American Airlines');
    expect(out[0].safety).toEqual({ accident_count_5y: 0, level: 'green' });

    expect(out[1].aircraft_icao).toBe('A388');
    expect(out[1].median_eur).toBe(700);
  });

  it('caches identical queries (cacheService TTL)', () => {
    db.prepare(`INSERT INTO route_aircraft_prices VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('LHR', 'JFK', 'B789', 500, 400, 600, 8, 'BAW', Date.now());
    const a = svc.getPricesForRoute('LHR', 'JFK');
    db.exec(`DELETE FROM route_aircraft_prices`);
    const b = svc.getPricesForRoute('LHR', 'JFK');
    expect(b).toBe(a);
  });
});

describe('getRoutesForAircraft', () => {
  it('returns empty array when no data', () => {
    expect(svc.getRoutesForAircraft('B789')).toEqual([]);
  });

  it('returns top-N routes for an aircraft sorted by n_quotes DESC', () => {
    db.prepare(`INSERT INTO route_aircraft_prices VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('LHR', 'JFK', 'B789', 500, 400, 600, 12, 'BAW', Date.now());
    db.prepare(`INSERT INTO route_aircraft_prices VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('LAX', 'LHR', 'B789', 620, 500, 800, 5, 'BAW', Date.now());
    db.prepare(`INSERT INTO route_aircraft_prices VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('SFO', 'LHR', 'B789', 700, 600, 900, 3, 'BAW', Date.now());
    db.prepare(`INSERT INTO route_aircraft_prices VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('LHR', 'JFK', 'A388', 800, 700, 900, 4, 'BAW', Date.now()); // different aircraft

    const out = svc.getRoutesForAircraft('b789');
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ dep_iata: 'LHR', arr_iata: 'JFK', n_quotes: 12 });
    expect(out[1]).toMatchObject({ dep_iata: 'LAX', arr_iata: 'LHR', n_quotes: 5 });
    expect(out[2]).toMatchObject({ dep_iata: 'SFO', arr_iata: 'LHR', n_quotes: 3 });
  });

  it('respects limit', () => {
    for (let i = 0; i < 15; i++) {
      db.prepare(`INSERT INTO route_aircraft_prices VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(`A${String(i).padStart(2,'0')}`, 'JFK', 'B789', 500, 400, 600, 15 - i, 'BAW', Date.now());
    }
    const out = svc.getRoutesForAircraft('B789', 5);
    expect(out).toHaveLength(5);
    expect(out[0].n_quotes).toBe(15);
    expect(out[4].n_quotes).toBe(11);
  });
});

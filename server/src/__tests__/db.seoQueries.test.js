// server/src/__tests__/db.seoQueries.test.js
const db = require('../models/db');

const NOW = Date.now();

beforeAll(() => {
  // Seed via the raw UPSERT helper. Note: the observed_routes PK is
  // (dep_iata, arr_iata, aircraft_icao), so to get 3 distinct airlines on
  // LHR-JFK we use 3 distinct aircraft codes (one per airline).
  // B77W -> BA, A359 -> AA, B789 -> VS. Also a separate B77W on other routes.
  function seed(dep, arr, icao, airline) {
    db.upsertObservedRoute({ depIata: dep, arrIata: arr, aircraftIcao: icao, airlineIata: airline, source: 'test' });
  }

  // 3 airlines on LHR-JFK, 3 different aircraft (one per airline)
  seed('LHR', 'JFK', 'B77W', 'BA');
  seed('LHR', 'JFK', 'A359', 'AA');
  seed('LHR', 'JFK', 'B789', 'VS');
  // B77W also flies other routes (different airlines)
  seed('JFK', 'CDG', 'B77W', 'AF');
  seed('LHR', 'DXB', 'B77W', 'EK');
});

describe('getRouteFacts', () => {
  it('returns airline count, aircraft count, top operators and aircraft for a city pair', () => {
    const facts = db.getRouteFacts('LHR', 'JFK');
    expect(facts.airlineCount).toBe(3);
    expect(facts.aircraftCount).toBe(3);
    expect(facts.topAirlines).toEqual(expect.arrayContaining(['BA', 'AA', 'VS']));
    expect(facts.topAircraft).toEqual(expect.arrayContaining(['B77W', 'A359', 'B789']));
  });

  it('is case-insensitive on input', () => {
    expect(db.getRouteFacts('lhr', 'jfk').airlineCount).toBe(3);
  });

  it('returns zeros for an unknown route', () => {
    const facts = db.getRouteFacts('AAA', 'BBB');
    expect(facts.airlineCount).toBe(0);
    expect(facts.aircraftCount).toBe(0);
    expect(facts.topAirlines).toEqual([]);
    expect(facts.topAircraft).toEqual([]);
  });
});

describe('getAircraftFacts', () => {
  it('counts distinct airlines and routes for an aircraft', () => {
    const facts = db.getAircraftFacts(['B77W']);
    // B77W flies LHR-JFK (BA), JFK-CDG (AF), LHR-DXB (EK) => 3 airlines, 3 routes
    expect(facts.airlineCount).toBeGreaterThanOrEqual(3);
    expect(facts.routeCount).toBeGreaterThanOrEqual(3);
  });
});

describe('getAircraftOperators', () => {
  it('returns top operators ordered by frequency', () => {
    const ops = db.getAircraftOperators(['B77W'], 10);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops[0]).toMatchObject({ airline: expect.any(String), count: expect.any(Number) });
  });
});

describe('getAircraftTopRoutes', () => {
  it('returns top routes ordered by frequency', () => {
    const routes = db.getAircraftTopRoutes(['B77W'], 10);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0]).toMatchObject({ from: expect.any(String), to: expect.any(String) });
  });
});

describe('getRouteCount', () => {
  it('returns distinct city pair count', () => {
    expect(db.getRouteCount()).toBeGreaterThanOrEqual(3);
  });
});

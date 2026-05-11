const { db, getTopAirportsByObservedActivity, getTopAirlinesByObservedActivity } = require('../models/db');

beforeEach(() => {
  db.exec('DELETE FROM observed_routes;');
});

function seed(rows) {
  const stmt = db.prepare(`INSERT INTO observed_routes
    (dep_iata, arr_iata, aircraft_icao, airline_iata, seen_at, first_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (const r of rows) stmt.run(r.dep, r.arr, r.ac, r.al, r.seen, r.first ?? r.seen);
}

describe('getTopAirportsByObservedActivity', () => {
  test('orders by combined dep+arr activity desc, returns top N', () => {
    // (dep, arr, aircraft_icao) is unique — vary aircraft to land all 5 rows.
    seed([
      { dep: 'JFK', arr: 'LHR', ac: 'B789', al: 'BA', seen: 1 },
      { dep: 'JFK', arr: 'CDG', ac: 'B789', al: 'AF', seen: 2 },
      { dep: 'JFK', arr: 'LAX', ac: 'B789', al: 'AA', seen: 3 },
      { dep: 'LHR', arr: 'JFK', ac: 'B789', al: 'BA', seen: 4 },
      { dep: 'XYZ', arr: 'LHR', ac: 'B789', al: 'BA', seen: 5 },
    ]);
    const top = getTopAirportsByObservedActivity({ limit: 10 });
    expect(top[0].iata).toBe('JFK');                            // 3 dep + 1 arr = 4
    expect(top.find(r => r.iata === 'LHR').activity).toBe(3);   // 1 dep + 2 arr
    expect(top.length).toBeLessThanOrEqual(10);
  });

  test('respects limit', () => {
    seed([
      { dep: 'AAA', arr: 'BBB', ac: 'B789', al: 'BA', seen: 1 },
      { dep: 'CCC', arr: 'DDD', ac: 'B789', al: 'BA', seen: 2 },
      { dep: 'EEE', arr: 'FFF', ac: 'B789', al: 'BA', seen: 3 },
    ]);
    expect(getTopAirportsByObservedActivity({ limit: 2 }).length).toBe(2);
  });
});

describe('getTopAirlinesByObservedActivity', () => {
  test('orders by row count desc, ignores null airlines', () => {
    // (dep, arr, aircraft_icao) is the unique key — vary aircraft_icao to get distinct rows.
    seed([
      { dep: 'JFK', arr: 'LHR', ac: 'B789', al: 'BA',   seen: 1 },
      { dep: 'JFK', arr: 'LHR', ac: 'A380', al: 'BA',   seen: 2 },
      { dep: 'JFK', arr: 'CDG', ac: 'B789', al: 'AF',   seen: 3 },
      { dep: 'JFK', arr: 'CDG', ac: 'A380', al: null,   seen: 4 },
    ]);
    const top = getTopAirlinesByObservedActivity({ limit: 10 });
    expect(top[0].iata).toBe('BA');
    expect(top[0].count).toBe(2);
    expect(top.find(r => r.iata === null)).toBeUndefined();
  });
});

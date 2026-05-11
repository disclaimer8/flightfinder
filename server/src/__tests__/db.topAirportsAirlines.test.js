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
  test('converts ICAO (stored in airline_iata column) to IATA via openFlights, orders by count desc, ignores null airlines and unmapped ICAOs', () => {
    // observed_routes.airline_iata stores ICAO codes (adsblol writes BAW for
    // British Airways, AFR for Air France, etc.), not IATA. The export
    // converts via openFlightsService.getAirlineByIcao.
    seed([
      { dep: 'JFK', arr: 'LHR', ac: 'B789', al: 'BAW',  seen: 1 },  // BAW (ICAO) → BA (IATA)
      { dep: 'JFK', arr: 'LHR', ac: 'A380', al: 'BAW',  seen: 2 },
      { dep: 'JFK', arr: 'CDG', ac: 'B789', al: 'AFR',  seen: 3 },  // AFR → AF
      { dep: 'JFK', arr: 'CDG', ac: 'A380', al: null,   seen: 4 },
      { dep: 'JFK', arr: 'LHR', ac: 'B77W', al: 'XYZQ', seen: 5 },  // XYZQ → no IATA mapping → dropped
    ]);
    const top = getTopAirlinesByObservedActivity({ limit: 10 });
    expect(top[0]).toMatchObject({ iata: 'BA', icao: 'BAW', count: 2 });
    expect(top.find(r => r.iata === 'AF')).toMatchObject({ icao: 'AFR', count: 1 });
    // XYZQ (unmapped ICAO) and null are both dropped
    expect(top.find(r => r.icao === 'XYZQ')).toBeUndefined();
    expect(top.find(r => r.iata === null)).toBeUndefined();
  });
});

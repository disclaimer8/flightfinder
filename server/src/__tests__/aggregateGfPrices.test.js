'use strict';
const Database = require('better-sqlite3');

jest.mock('../services/openFlightsService', () => ({
  getAirlineByName: jest.fn((name) => {
    const m = {
      'British Airways': { iata: 'BA', icao: 'BAW', name: 'British Airways' },
      'American Airlines': { iata: 'AA', icao: 'AAL', name: 'American Airlines' },
      'American':         { iata: 'AA', icao: 'AAL', name: 'American Airlines' },
      'Iberia':           { iata: 'IB', icao: 'IBE', name: 'Iberia' },
    };
    return m[name] || null;
  }),
}));

const { aggregate } = require('../scripts/aggregate-gf-prices');

function newAppDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE fr24_gf_route_aircraft (
      dep_iata TEXT, arr_iata TEXT, aircraft_icao TEXT, airline_icao TEXT,
      sample_size INTEGER, first_seen_at INTEGER, last_seen_at INTEGER,
      PRIMARY KEY (dep_iata, arr_iata, aircraft_icao, airline_icao)
    );
    CREATE TABLE route_aircraft_prices (
      dep_iata TEXT, arr_iata TEXT, aircraft_icao TEXT,
      median_eur REAL, min_eur REAL, max_eur REAL,
      n_quotes INTEGER, airlines_csv TEXT, snapshot_at INTEGER,
      PRIMARY KEY (dep_iata, arr_iata, aircraft_icao)
    );
    CREATE TABLE route_aircraft_prices_meta (
      run_id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER, ended_at INTEGER,
      pairs_processed INTEGER, buckets_in INTEGER, buckets_out INTEGER,
      quotes_total INTEGER, skipped_thin INTEGER, skipped_no_match INTEGER,
      status TEXT
    );
  `);
  return db;
}

function newAccidentsDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE flights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT, destination TEXT, date TEXT, price TEXT,
      airline TEXT, departure_time TEXT, arrival_time TEXT,
      duration TEXT, stops TEXT, crawled_at TEXT
    );
  `);
  return db;
}

it('aggregates a single pair with one aircraft and three quotes', () => {
  const appDb = newAppDb();
  const accDb = newAccidentsDb();

  appDb.prepare(`INSERT INTO fr24_gf_route_aircraft VALUES (?,?,?,?,?,?,?)`)
    .run('LHR', 'JFK', 'B789', 'BAW', 10, Date.now(), Date.now());

  for (const price of ['€500', '€550', '€600']) {
    accDb.prepare(`INSERT INTO flights(origin,destination,price,airline,stops) VALUES (?,?,?,?,?)`)
      .run('LHR', 'JFK', price, 'British Airways', 'Nonstop');
  }

  const result = aggregate({ appDb, accDb });

  expect(result.pairsProcessed).toBe(1);
  expect(result.bucketsOut).toBe(1);
  expect(result.quotesTotal).toBe(3);

  const rows = appDb.prepare('SELECT * FROM route_aircraft_prices').all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    dep_iata: 'LHR', arr_iata: 'JFK', aircraft_icao: 'B789',
    median_eur: 550, min_eur: 500, max_eur: 600,
    n_quotes: 3, airlines_csv: 'BAW',
  });
});

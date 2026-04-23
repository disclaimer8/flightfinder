'use strict';

describe('safety_events schema migration', () => {
  let db;
  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    db = require('../models/db').db;
  });

  test('safety_events table exists with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info(safety_events)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'source', 'source_event_id', 'occurred_at',
      'severity', 'fatalities', 'injuries', 'hull_loss',
      'cictt_category', 'phase_of_flight',
      'operator_iata', 'operator_icao', 'operator_name',
      'aircraft_icao_type', 'registration',
      'dep_iata', 'arr_iata', 'location_country', 'location_lat', 'location_lon',
      'narrative', 'report_url', 'ingested_at', 'updated_at',
    ]));
  });

  test('UNIQUE (source, source_event_id) enforced', () => {
    const insert = db.prepare(`
      INSERT INTO safety_events
        (source, source_event_id, occurred_at, severity, fatalities, injuries,
         hull_loss, cictt_category, phase_of_flight, operator_iata, operator_icao,
         operator_name, aircraft_icao_type, registration, dep_iata, arr_iata,
         location_country, location_lat, location_lon, narrative, report_url,
         ingested_at, updated_at)
      VALUES ('ntsb','TEST-1',1700000000000,'incident',0,0,0,'OTHR','CRZ',
              null,null,null,null,null,null,null,null,null,null,null,null,
              1700000000000,1700000000000)
    `);
    insert.run();
    expect(() => insert.run()).toThrow(/UNIQUE/);
  });

  test('rerunning the table+ALTERs does not throw', () => {
    expect(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS safety_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        severity TEXT NOT NULL,
        fatalities INTEGER NOT NULL DEFAULT 0,
        injuries INTEGER NOT NULL DEFAULT 0,
        hull_loss INTEGER NOT NULL DEFAULT 0,
        cictt_category TEXT,
        phase_of_flight TEXT,
        operator_iata TEXT,
        operator_icao TEXT,
        operator_name TEXT,
        aircraft_icao_type TEXT,
        registration TEXT,
        dep_iata TEXT,
        arr_iata TEXT,
        location_country TEXT,
        location_lat REAL,
        location_lon REAL,
        narrative TEXT,
        report_url TEXT,
        ingested_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(source, source_event_id)
      )`);
    }).not.toThrow();
  });
});

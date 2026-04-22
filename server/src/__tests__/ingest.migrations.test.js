// Verifies all new ingestion tables exist with the expected columns.

describe('ingestion schema migrations', () => {
  let db;
  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    db = require('../models/db').db;
  });

  const table = (name) => db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);

  test('flight_observations has expected columns', () => {
    expect(table('flight_observations')).toEqual(expect.arrayContaining([
      'id','dep_iata','arr_iata','airline_iata','flight_number','aircraft_icao',
      'scheduled_dep','actual_dep','scheduled_arr','actual_arr','delay_minutes',
      'status','observed_at',
    ]));
  });

  test('aircraft_fleet has expected columns', () => {
    expect(table('aircraft_fleet')).toEqual(expect.arrayContaining([
      'icao24','registration','icao_type','operator_iata','build_year','first_seen_at','updated_at',
    ]));
  });

  test('airline_liveries has expected columns', () => {
    expect(table('airline_liveries')).toEqual(expect.arrayContaining([
      'airline_iata','icao_type','image_url','attribution','fetched_at',
    ]));
  });

  test('airline_amenities has expected columns', () => {
    expect(table('airline_amenities')).toEqual(expect.arrayContaining([
      'airline_iata','icao_type_hint','wifi','power','entertainment','meal','updated_at',
    ]));
  });
});

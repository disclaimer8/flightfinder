'use strict';
describe('faa_registry schema migration', () => {
  let db;
  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    db = require('../models/db').db;
  });
  test('faa_registry table exists with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info(faa_registry)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'n_number', 'icao24_hex', 'manufacturer', 'model', 'year_built',
      'owner_name', 'updated_at',
    ]));
  });
  test('PRIMARY KEY on n_number', () => {
    const pragma = db.prepare("PRAGMA table_info(faa_registry)").all();
    const pk = pragma.find(c => c.name === 'n_number');
    expect(pk.pk).toBe(1);
  });
});

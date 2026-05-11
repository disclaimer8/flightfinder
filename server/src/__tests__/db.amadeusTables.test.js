const { db } = require('../models/db');

describe('amadeus tables', () => {
  test('amadeus_cache table exists with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info('amadeus_cache')").all();
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual(['endpoint', 'expires_at', 'fetched_at', 'key', 'payload_json']);
  });

  test('amadeus_cache primary key is (endpoint, key)', () => {
    const cols = db.prepare("PRAGMA table_info('amadeus_cache')").all();
    const pk = cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    expect(pk).toEqual(['endpoint', 'key']);
  });

  test('idx_amadeus_cache_expires index exists', () => {
    const idx = db.prepare("PRAGMA index_list('amadeus_cache')").all();
    expect(idx.map(i => i.name)).toContain('idx_amadeus_cache_expires');
  });

  test('amadeus_budget table exists with day_utc primary key', () => {
    const cols = db.prepare("PRAGMA table_info('amadeus_budget')").all();
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual(['calls', 'day_utc', 'errors']);
    const pk = cols.filter(c => c.pk > 0).map(c => c.name);
    expect(pk).toEqual(['day_utc']);
  });
});

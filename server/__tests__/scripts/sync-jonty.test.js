'use strict';

const Database = require('better-sqlite3');
const { runImport, validateShape, SCHEMA } = require('../../scripts/sync-jonty');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

const FIXTURE = {
  LHR: {
    iata: 'LHR',
    icao: 'EGLL',
    name: 'Heathrow',
    city_name: 'London',
    country: 'United Kingdom',
    country_code: 'GB',
    continent: 'EU',
    latitude: '51.469603',
    longitude: '-0.453566',
    elevation: 80,
    timezone: 'Europe/London',
    display_name: 'London (LHR), United Kingdom',
    routes: [
      {
        iata: 'AMS',
        km: 371,
        min: 80,
        carriers: [
          { iata: 'BA', name: 'British Airways' },
          { iata: 'KL', name: 'KLM' },
        ],
      },
      {
        iata: 'JFK',
        km: 5540,
        min: 420,
        carriers: [{ iata: 'BA', name: 'British Airways' }],
      },
    ],
  },
  JFK: {
    iata: 'JFK',
    icao: 'KJFK',
    name: 'John F. Kennedy International',
    city_name: 'New York',
    country: 'United States',
    country_code: 'US',
    continent: 'NA',
    latitude: '40.639751',
    longitude: '-73.778925',
    elevation: 4,
    timezone: 'America/New_York',
    display_name: 'New York (JFK), United States',
    routes: [
      {
        iata: 'LHR',
        km: 5540,
        min: 415,
        carriers: [
          { iata: 'BA', name: 'British Airways' },
          { iata: 'AA', name: 'American Airlines' },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runImport — inserts airport metadata correctly', () => {
  let db;

  beforeEach(() => {
    db = makeDb();
    runImport(FIXTURE, db);
  });

  afterEach(() => db.close());

  test('airports table has exactly 2 rows', () => {
    const rows = db.prepare('SELECT * FROM airports').all();
    expect(rows).toHaveLength(2);
  });

  test('LHR airport fields are correct', () => {
    const row = db.prepare('SELECT * FROM airports WHERE iata=?').get('LHR');
    expect(row).toMatchObject({
      iata:         'LHR',
      icao:         'EGLL',
      name:         'Heathrow',
      city:         'London',
      country:      'United Kingdom',
      country_code: 'GB',
      continent:    'EU',
      elevation:    80,
      timezone:     'Europe/London',
      display_name: 'London (LHR), United Kingdom',
    });
    // latitude/longitude stored as REAL (number), not string
    expect(typeof row.latitude).toBe('number');
    expect(row.latitude).toBeCloseTo(51.469603, 4);
    expect(typeof row.longitude).toBe('number');
    expect(row.longitude).toBeCloseTo(-0.453566, 4);
  });

  test('routes table has LHR→AMS, LHR→JFK, JFK→LHR (3 rows total)', () => {
    const rows = db.prepare('SELECT * FROM routes').all();
    expect(rows).toHaveLength(3);
    const origins = rows.map(r => r.origin_iata);
    expect(origins).toEqual(expect.arrayContaining(['LHR', 'LHR', 'JFK']));
  });

  test('LHR→AMS route has correct km and duration', () => {
    const row = db.prepare(
      'SELECT * FROM routes WHERE origin_iata=? AND dest_iata=?'
    ).get('LHR', 'AMS');
    expect(row).toMatchObject({ km: 371, duration_min: 80 });
  });

  test('route_carriers has expected rows', () => {
    const rows = db.prepare('SELECT * FROM route_carriers').all();
    // LHR→AMS: BA + KL; LHR→JFK: BA; JFK→LHR: BA + AA = 5 total
    expect(rows).toHaveLength(5);
    const lhrAms = rows.filter(r => r.origin_iata === 'LHR' && r.dest_iata === 'AMS');
    expect(lhrAms.map(r => r.carrier_iata).sort()).toEqual(['BA', 'KL']);
  });
});

describe('runImport — idempotency', () => {
  let db;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => db.close());

  test('running twice produces same row counts (no duplicates)', () => {
    runImport(FIXTURE, db);
    runImport(FIXTURE, db);

    const airports  = db.prepare('SELECT COUNT(*) AS n FROM airports').get().n;
    const routes    = db.prepare('SELECT COUNT(*) AS n FROM routes').get().n;
    const carriers  = db.prepare('SELECT COUNT(*) AS n FROM route_carriers').get().n;

    expect(airports).toBe(2);
    expect(routes).toBe(3);
    expect(carriers).toBe(5);
  });
});

describe('runImport — handles missing optional fields', () => {
  let db;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => db.close());

  test('entry with no icao, no elevation, no timezone inserts nulls without error', () => {
    const sparse = {
      ABX: {
        iata: 'ABX',
        name: 'Albury Airport',
        routes: [],
        // icao, elevation, timezone intentionally absent
      },
    };
    expect(() => runImport(sparse, db)).not.toThrow();
    const row = db.prepare('SELECT * FROM airports WHERE iata=?').get('ABX');
    expect(row).not.toBeNull();
    expect(row.icao).toBeNull();
    expect(row.elevation).toBeNull();
    expect(row.timezone).toBeNull();
  });
});

describe('validateShape — rejects malformed input', () => {
  test('top-level array throws with clear message', () => {
    const result = validateShape([{ iata: 'LHR' }]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/plain object/i);
  });

  test('top-level string throws with clear message', () => {
    const result = validateShape('not an object');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/plain object/i);
  });

  test('top-level null throws with clear message', () => {
    const result = validateShape(null);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/plain object/i);
  });

  test('entry missing required iata field fails validation', () => {
    const result = validateShape({
      BAD: {
        // iata intentionally missing
        name: 'Bad Airport',
        routes: [],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('BAD');
  });

  test('entry missing routes array fails validation', () => {
    const result = validateShape({
      XYZ: {
        iata: 'XYZ',
        name: 'XYZ Airport',
        // routes intentionally missing
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('XYZ');
  });

  test('valid data passes validation', () => {
    const result = validateShape(FIXTURE);
    expect(result.ok).toBe(true);
  });
});

describe('runImport — meta table is populated', () => {
  let db;

  beforeEach(() => {
    db = makeDb();
    runImport(FIXTURE, db, { etag: '"abc123"', sizeBytes: 12345 });
  });

  afterEach(() => db.close());

  test('meta has source_etag', () => {
    const row = db.prepare("SELECT value FROM meta WHERE key='source_etag'").get();
    expect(row.value).toBe('"abc123"');
  });

  test('meta has last_sync_utc as ISO string', () => {
    const row = db.prepare("SELECT value FROM meta WHERE key='last_sync_utc'").get();
    expect(row.value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('meta has correct airport_count', () => {
    const row = db.prepare("SELECT value FROM meta WHERE key='airport_count'").get();
    expect(row.value).toBe('2');
  });
});

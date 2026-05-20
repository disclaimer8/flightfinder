// Regression: PR #85 shipped `SELECT * FROM pragma_wal_checkpoint('TRUNCATE')`
// which requires SQLite compiled with SQLITE_ENABLE_PRAGMA_FUNCTIONS — not
// enabled in better-sqlite3's bundled build. Prod logs showed the cycle
// failing every hour with "no such table: pragma_wal_checkpoint". This test
// runs one cycle against a real in-process DB and asserts success logging.

describe('dbMaintenanceWorker.runCycle', () => {
  let worker;
  let logSpy;
  let warnSpy;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    jest.resetModules();
    require('../models/db');
    worker = require('../workers/dbMaintenanceWorker');
  });

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('runs WAL checkpoint + incremental_vacuum without throwing', () => {
    expect(() => worker._runCycleForTest()).not.toThrow();
  });

  test('logs success line containing checkpoint metrics, not failure', () => {
    worker._runCycleForTest();
    const successLogs = logSpy.mock.calls
      .map(args => args.join(' '))
      .filter(line => line.includes('[db-maintenance] checkpoint'));
    expect(successLogs.length).toBeGreaterThan(0);
    expect(successLogs[0]).toMatch(/busy=\d+/);
    expect(successLogs[0]).toMatch(/log=-?\d+/);
    expect(successLogs[0]).toMatch(/checkpointed=-?\d+/);
    expect(successLogs[0]).toMatch(/incremental_vacuum freed=/);

    const failureWarns = warnSpy.mock.calls
      .map(args => args.join(' '))
      .filter(line => line.includes('[db-maintenance] cycle failed'));
    expect(failureWarns).toEqual([]);
  });
});

describe('dbMaintenanceWorker — adsbdb cache GC', () => {
  it('deletes adsbdb_callsign_cache rows expired more than 30 days ago', () => {
    process.env.NODE_ENV = 'test';
    jest.resetModules();
    const { db } = require('../models/db');
    const dbMaintenanceWorker = require('../workers/dbMaintenanceWorker');

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    db.prepare(
      `INSERT INTO adsbdb_callsign_cache (callsign, dep_iata, arr_iata, dep_icao, arr_icao, airline_iata, airline_icao, resolved_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('OLD1', 'LHR', 'JFK', null, null, null, null, now - 60 * dayMs, now - 31 * dayMs);
    db.prepare(
      `INSERT INTO adsbdb_callsign_cache (callsign, dep_iata, arr_iata, dep_icao, arr_icao, airline_iata, airline_icao, resolved_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('FRESH1', 'CDG', 'NRT', null, null, null, null, now, now + 7 * dayMs);
    db.prepare(
      `INSERT INTO adsbdb_callsign_cache (callsign, dep_iata, arr_iata, dep_icao, arr_icao, airline_iata, airline_icao, resolved_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('RECENT_EXPIRED', 'MAD', 'BCN', null, null, null, null, now - 10 * dayMs, now - 5 * dayMs);

    dbMaintenanceWorker._runCycleForTest();

    const remaining = db.prepare('SELECT callsign FROM adsbdb_callsign_cache ORDER BY callsign').all().map(r => r.callsign);
    expect(remaining).toEqual(['FRESH1', 'RECENT_EXPIRED']);
  });
});

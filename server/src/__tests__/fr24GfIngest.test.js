const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireLockOrExit, releaseLock } = require('../../scripts/fr24GfIngest');

describe('acquireLockOrExit', () => {
  let lockPath;
  let exitSpy;
  let errSpy;

  beforeEach(() => {
    lockPath = path.join(os.tmpdir(), `fr24-gf-ingest-test-${process.pid}-${Math.random().toString(36).slice(2)}.lock`);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`__EXIT_${code}__`); });
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    try { fs.unlinkSync(lockPath); } catch {}
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('writes pid to lock file when none exists', () => {
    acquireLockOrExit(lockPath);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(parseInt(fs.readFileSync(lockPath, 'utf8'), 10)).toBe(process.pid);
    releaseLock(lockPath);
  });

  it('releaseLock removes the file', () => {
    acquireLockOrExit(lockPath);
    releaseLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('exits with code 0 when live PID holds the lock', () => {
    fs.writeFileSync(lockPath, String(process.pid));        // our own PID = alive
    expect(() => acquireLockOrExit(lockPath)).toThrow('__EXIT_0__');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('previous run still active'));
  });

  it('cleans up stale lock when PID is dead, then acquires', () => {
    fs.writeFileSync(lockPath, '999999');                   // very high PID — likely dead
    acquireLockOrExit(lockPath);
    expect(parseInt(fs.readFileSync(lockPath, 'utf8'), 10)).toBe(process.pid);
    releaseLock(lockPath);
  });
});

jest.mock('../services/fr24Service', () => ({
  isEnabled: jest.fn(() => true),
  fetchRouteAircraftBuckets: jest.fn(),
}));

const fr24Service = require('../services/fr24Service');
const { db, upsertFr24GfRoutes } = require('../models/db');
const { runIngest } = require('../../scripts/fr24GfIngest');

describe('runIngest (orchestration)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM fr24_gf_route_aircraft');
    db.exec('DELETE FROM fr24_gf_ingest_meta');
    jest.clearAllMocks();
    fr24Service.isEnabled.mockReturnValue(true);
  });

  it('exits early with meta row when fr24 disabled', async () => {
    fr24Service.isEnabled.mockReturnValue(false);
    const result = await runIngest({
      pairs: [{ dep: 'LHR', arr: 'JFK' }],
      ttlMs: 7 * 24 * 3600 * 1000,
      rateMs: 0,
    });
    expect(result.error_summary).toMatch(/FR24 disabled/);
    expect(result.pairs_queried).toBe(0);
    expect(fr24Service.fetchRouteAircraftBuckets).not.toHaveBeenCalled();
    const metaRows = db.prepare('SELECT * FROM fr24_gf_ingest_meta').all();
    expect(metaRows).toHaveLength(1);
    expect(metaRows[0].error_summary).toMatch(/FR24 disabled/);
  });

  it('queries fresh pairs, skips TTL-gated, upserts buckets, writes meta', async () => {
    fr24Service.fetchRouteAircraftBuckets.mockImplementation(async (_orig, _dest) => ([
      { aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 2 },
      { aircraft_icao: 'A332', airline_icao: 'AAL', sample_size: 1 },
    ]));

    const now = Date.now();
    // Pre-seed a fresh row for LHR-FRA → should be skipped
    upsertFr24GfRoutes([
      { dep_iata: 'LHR', arr_iata: 'FRA', aircraft_icao: 'A20N', airline_icao: 'DLH', sample_size: 5, first_seen_at: now, last_seen_at: now },
    ]);

    const result = await runIngest({
      pairs: [
        { dep: 'LHR', arr: 'JFK' },
        { dep: 'LHR', arr: 'FRA' },  // TTL-gated
      ],
      ttlMs: 7 * 24 * 3600 * 1000,
      rateMs: 0,
    });

    expect(result.pairs_total).toBe(2);
    expect(result.pairs_queried).toBe(1);
    expect(result.pairs_skipped).toBe(1);
    expect(result.pairs_empty).toBe(0);
    expect(result.pairs_failed).toBe(0);
    expect(result.rows_upserted).toBe(2);              // B77W/BAW + A332/AAL
    expect(fr24Service.fetchRouteAircraftBuckets).toHaveBeenCalledWith('LHR', 'JFK');
    expect(fr24Service.fetchRouteAircraftBuckets).not.toHaveBeenCalledWith('LHR', 'FRA');

    const lhrJfk = db.prepare("SELECT * FROM fr24_gf_route_aircraft WHERE dep_iata='LHR' AND arr_iata='JFK' ORDER BY aircraft_icao").all();
    expect(lhrJfk).toHaveLength(2);
    expect(lhrJfk[0]).toMatchObject({ aircraft_icao: 'A332', airline_icao: 'AAL', sample_size: 1 });
    expect(lhrJfk[1]).toMatchObject({ aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 2 });
  });

  it('counts empty FR24 results without writing aircraft rows', async () => {
    fr24Service.fetchRouteAircraftBuckets.mockResolvedValue([]);
    const result = await runIngest({
      pairs: [{ dep: 'LHR', arr: 'XYZ' }],
      ttlMs: 7 * 24 * 3600 * 1000,
      rateMs: 0,
    });
    expect(result.pairs_queried).toBe(1);
    expect(result.pairs_empty).toBe(1);
    expect(result.rows_upserted).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM fr24_gf_route_aircraft').get().n).toBe(0);
  });

  it('counts failed fetches without aborting the run (thrown error)', async () => {
    fr24Service.fetchRouteAircraftBuckets
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockResolvedValueOnce([{ aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 1 }]);
    const result = await runIngest({
      pairs: [{ dep: 'LHR', arr: 'JFK' }, { dep: 'LHR', arr: 'LAX' }],
      ttlMs: 7 * 24 * 3600 * 1000,
      rateMs: 0,
    });
    expect(result.pairs_failed).toBe(1);
    expect(result.pairs_queried).toBe(1);
    expect(result.rows_upserted).toBe(1);
    expect(result.error_summary).toBeUndefined();
  });

  it('counts failed fetches without aborting the run (null return)', async () => {
    // null = service swallowed an error internally per its contract
    fr24Service.fetchRouteAircraftBuckets
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([{ aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 1 }]);
    const result = await runIngest({
      pairs: [{ dep: 'LHR', arr: 'JFK' }, { dep: 'LHR', arr: 'LAX' }],
      ttlMs: 7 * 24 * 3600 * 1000,
      rateMs: 0,
    });
    expect(result.pairs_failed).toBe(1);
    expect(result.pairs_queried).toBe(1);
    expect(result.rows_upserted).toBe(1);
    expect(result.error_summary).toBeUndefined();
  });

  it('writes error_summary in meta when failure rate exceeds 30%', async () => {
    fr24Service.fetchRouteAircraftBuckets.mockResolvedValue(null);
    const result = await runIngest({
      pairs: [{ dep: 'A', arr: 'B' }, { dep: 'A', arr: 'C' }, { dep: 'A', arr: 'D' }],
      ttlMs: 7 * 24 * 3600 * 1000,
      rateMs: 0,
    });
    expect(result.pairs_failed).toBe(3);
    expect(result.error_summary).toMatch(/failure rate/i);
    const meta = db.prepare('SELECT error_summary FROM fr24_gf_ingest_meta').get();
    expect(meta.error_summary).toMatch(/failure rate/i);
  });
});

describe('coverage probe', () => {
  beforeEach(() => {
    db.exec('DELETE FROM fr24_gf_route_aircraft');
  });

  it('computeCoverage returns pair counts and percentage', () => {
    const { computeCoverage } = require('../../scripts/fr24GfIngest');
    const now = Date.now();
    upsertFr24GfRoutes([
      { dep_iata: 'LHR', arr_iata: 'JFK', aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 5, first_seen_at: now, last_seen_at: now },
      { dep_iata: 'LHR', arr_iata: 'FRA', aircraft_icao: 'A20N', airline_icao: 'DLH', sample_size: 3, first_seen_at: now, last_seen_at: now },
    ]);
    const gfPairs = [
      { dep: 'LHR', arr: 'JFK' },
      { dep: 'LHR', arr: 'FRA' },
      { dep: 'LHR', arr: 'LAX' },
      { dep: 'LHR', arr: 'AMS' },
    ];
    const cov = computeCoverage(gfPairs);
    expect(cov.gf_pairs).toBe(4);
    expect(cov.covered_pairs).toBe(2);
    expect(cov.pct).toBeCloseTo(50.0, 1);
  });

  it('computeCoverage handles empty inputs gracefully', () => {
    const { computeCoverage } = require('../../scripts/fr24GfIngest');
    expect(computeCoverage([])).toEqual({ gf_pairs: 0, covered_pairs: 0, pct: 0 });
  });
});

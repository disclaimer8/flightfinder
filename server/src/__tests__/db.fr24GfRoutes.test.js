const { db, fr24GfRouteFreshExists, upsertFr24GfRoutes, writeFr24GfIngestMeta } = require('../models/db');

describe('fr24_gf_route_aircraft schema', () => {
  it('table exists with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info(fr24_gf_route_aircraft)").all();
    const byName = Object.fromEntries(cols.map(c => [c.name, c]));
    expect(byName.dep_iata).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.arr_iata).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.aircraft_icao).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.airline_icao).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "''" });
    expect(byName.sample_size).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(byName.first_seen_at).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(byName.last_seen_at).toMatchObject({ type: 'INTEGER', notnull: 1 });
    const pk = cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    expect(pk).toEqual(['dep_iata', 'arr_iata', 'aircraft_icao', 'airline_icao']);
  });

  it('indexes exist', () => {
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='fr24_gf_route_aircraft'").all().map(r => r.name);
    expect(idx).toEqual(expect.arrayContaining(['idx_fgra_pair', 'idx_fgra_fresh']));
  });
});

describe('fr24_gf_ingest_meta schema', () => {
  it('table exists with autoincrement PK', () => {
    const cols = db.prepare("PRAGMA table_info(fr24_gf_ingest_meta)").all();
    const byName = Object.fromEntries(cols.map(c => [c.name, c]));
    expect(byName.run_id).toMatchObject({ pk: 1 });
    expect(byName.started_at).toMatchObject({ notnull: 1 });
    for (const f of ['pairs_total','pairs_queried','pairs_skipped','pairs_empty','pairs_failed','rows_upserted','credits_used','error_summary','finished_at']) {
      expect(byName[f]).toBeDefined();
    }
  });
});

describe('fr24GfRouteFreshExists', () => {
  beforeEach(() => {
    db.exec('DELETE FROM fr24_gf_route_aircraft');
  });

  it('returns false when no row for pair', () => {
    expect(fr24GfRouteFreshExists('LHR', 'JFK', 0)).toBe(false);
  });

  it('returns true when a row with last_seen_at >= cutoff exists', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO fr24_gf_route_aircraft
        (dep_iata, arr_iata, aircraft_icao, airline_icao, sample_size, first_seen_at, last_seen_at)
      VALUES ('LHR','JFK','B77W','BAW',5,?,?)
    `).run(now - 1000, now - 1000);
    expect(fr24GfRouteFreshExists('LHR', 'JFK', now - 10000)).toBe(true);
  });

  it('returns false when all rows for pair are older than cutoff', () => {
    const now = Date.now();
    const old = now - 10 * 24 * 3600 * 1000;
    db.prepare(`
      INSERT INTO fr24_gf_route_aircraft VALUES ('LHR','JFK','B77W','BAW',5,?,?)
    `).run(old, old);
    expect(fr24GfRouteFreshExists('LHR', 'JFK', now - 7 * 24 * 3600 * 1000)).toBe(false);
  });

  it('scoped per pair (other pair fresh does not leak)', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO fr24_gf_route_aircraft VALUES ('LHR','FRA','A20N','BAW',5,?,?)
    `).run(now, now);
    expect(fr24GfRouteFreshExists('LHR', 'JFK', now - 1000)).toBe(false);
  });

  it('inclusive at the boundary (last_seen_at === cutoff)', () => {
    const t = Date.now();
    db.prepare(`
      INSERT INTO fr24_gf_route_aircraft
        (dep_iata, arr_iata, aircraft_icao, airline_icao, sample_size, first_seen_at, last_seen_at)
      VALUES ('LHR','JFK','B77W','BAW',5,?,?)
    `).run(t, t);
    expect(fr24GfRouteFreshExists('LHR', 'JFK', t)).toBe(true);
  });
});

describe('upsertFr24GfRoutes', () => {
  beforeEach(() => {
    db.exec('DELETE FROM fr24_gf_route_aircraft');
  });

  it('inserts new rows and returns count', () => {
    const now = Date.now();
    const inserted = upsertFr24GfRoutes([
      { dep_iata: 'LHR', arr_iata: 'JFK', aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 5, first_seen_at: now, last_seen_at: now },
      { dep_iata: 'LHR', arr_iata: 'JFK', aircraft_icao: 'A332', airline_icao: 'AAL', sample_size: 2, first_seen_at: now, last_seen_at: now },
    ]);
    expect(inserted).toBe(2);
    const rows = db.prepare('SELECT * FROM fr24_gf_route_aircraft ORDER BY aircraft_icao').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ aircraft_icao: 'A332', sample_size: 2 });
    expect(rows[1]).toMatchObject({ aircraft_icao: 'B77W', sample_size: 5 });
  });

  it('replaces sample_size and last_seen_at on conflict; preserves first_seen_at', () => {
    const t0 = 1700000000000;
    const t1 = t0 + 7 * 24 * 3600 * 1000;
    upsertFr24GfRoutes([
      { dep_iata: 'LHR', arr_iata: 'JFK', aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 5, first_seen_at: t0, last_seen_at: t0 },
    ]);
    upsertFr24GfRoutes([
      { dep_iata: 'LHR', arr_iata: 'JFK', aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 18, first_seen_at: t1, last_seen_at: t1 },
    ]);
    const row = db.prepare(`SELECT * FROM fr24_gf_route_aircraft WHERE aircraft_icao='B77W'`).get();
    expect(row.sample_size).toBe(18);        // replaced
    expect(row.last_seen_at).toBe(t1);       // refreshed
    expect(row.first_seen_at).toBe(t0);      // preserved
  });

  it('empty array returns 0 and is a no-op', () => {
    expect(upsertFr24GfRoutes([])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM fr24_gf_route_aircraft').get().n).toBe(0);
  });

  it('different airline_icao for same (dep,arr,aircraft) creates separate rows', () => {
    const now = Date.now();
    upsertFr24GfRoutes([
      { dep_iata: 'LHR', arr_iata: 'JFK', aircraft_icao: 'B77W', airline_icao: 'BAW', sample_size: 5, first_seen_at: now, last_seen_at: now },
      { dep_iata: 'LHR', arr_iata: 'JFK', aircraft_icao: 'B77W', airline_icao: 'AAL', sample_size: 3, first_seen_at: now, last_seen_at: now },
    ]);
    const rows = db.prepare(
      `SELECT airline_icao, sample_size FROM fr24_gf_route_aircraft
       WHERE aircraft_icao='B77W' ORDER BY airline_icao`
    ).all();
    expect(rows).toEqual([
      { airline_icao: 'AAL', sample_size: 3 },
      { airline_icao: 'BAW', sample_size: 5 },
    ]);
  });
});

describe('writeFr24GfIngestMeta', () => {
  beforeEach(() => {
    db.exec('DELETE FROM fr24_gf_ingest_meta');
  });

  it('inserts a meta row and returns run_id', () => {
    const runId = writeFr24GfIngestMeta({
      started_at: 1700000000000,
      finished_at: 1700001000000,
      pairs_total: 182,
      pairs_queried: 26,
      pairs_skipped: 148,
      pairs_empty: 5,
      pairs_failed: 3,
      rows_upserted: 89,
      credits_used: 26,
      error_summary: null,
    });
    expect(typeof runId).toBe('number');
    expect(runId).toBeGreaterThan(0);
    const row = db.prepare('SELECT * FROM fr24_gf_ingest_meta WHERE run_id = ?').get(runId);
    expect(row).toMatchObject({
      started_at: 1700000000000,
      finished_at: 1700001000000,
      pairs_total: 182,
      pairs_queried: 26,
      rows_upserted: 89,
      credits_used: 26,
    });
    expect(row.error_summary).toBeNull();
  });

  it('accepts nullable finished_at and error_summary', () => {
    const runId = writeFr24GfIngestMeta({
      started_at: 1700000000000,
      finished_at: null,
      pairs_total: 0, pairs_queried: 0, pairs_skipped: 0,
      pairs_empty: 0, pairs_failed: 0, rows_upserted: 0, credits_used: 0,
      error_summary: 'lock acquire failed',
    });
    const row = db.prepare('SELECT * FROM fr24_gf_ingest_meta WHERE run_id = ?').get(runId);
    expect(row.finished_at).toBeNull();
    expect(row.error_summary).toBe('lock acquire failed');
  });
});

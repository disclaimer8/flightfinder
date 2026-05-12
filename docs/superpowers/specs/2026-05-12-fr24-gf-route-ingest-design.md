# FR24 → GF Route Aircraft Ingest

**Date:** 2026-05-12
**Status:** Design
**Owner:** Denys

---

## Problem

The Aircraft × Price widget (paused design, see [`project_aircraft-price-widget`](../../../) memory) needs to associate Google Flights price quotes with aircraft types. GF data does not include aircraft. The original plan joined `gf.flights` against `observed_routes` (FR24/ADS-B observations on the FF server) on `(origin, destination, airline)`.

A probe run on 2026-05-12 against prod data showed the join is unviable as designed:

| Source | Origins | Distinct pairs |
|---|---|---|
| `gf.flights` (AirCrash scraper output) | 14 hub airports | 182 |
| `observed_routes` (prod app.db) | 797 | 3,468 |
| **Overlap** | — | **18 (9.9%)** |

- Row-level theoretical match ceiling: **10.1%** (1,195 / 11,845 GF rows have at least the pair present in OR — before any airline/aircraft filtering).
- Increasing `flights` volume does not lift this ceiling — the bottleneck is **route-input misalignment**, not quote count.
- Of the 18 overlapping pairs, 11 have ≥ 2 aircraft observed → need airline disambiguation to pin one aircraft per quote.

The 40% match-rate gate from the original brainstorm is mathematically unreachable on the current 182 pairs without changing one of the inputs.

## Goal

Steer FR24 ingest at the same 182 (and future N) pairs that the GF scraper covers, so the join input is aligned by construction. Keep the GF scraper's quote density (don't dilute its scrape across 3,468 pairs); instead pull FR24 aircraft observations specifically for the routes GF is already scraping.

**Non-goals (separate future specs):**

- `aggregate-gf-prices.js` aggregation script (reads this table → writes `route_aircraft_prices`).
- Aircraft × Price widget UI / SEO baking.
- Changes to the AirCrash Go scraper itself.

## Architecture

```
              ┌────────────────────────────┐
  03:00 UTC   │ existing daily app.db backup (unchanged)
  04:30 UTC   │ NEW cron:
              │   node server/scripts/fr24GfIngest.js
              │
              │   1. SELECT DISTINCT origin, destination
              │      FROM accidents.db (ATTACH) gf.flights
              │      → ~182 pairs
              │
              │   2. For each pair:
              │      - skip if last_seen_at within TTL (7d default)
              │      - fr24Service.fetchRouteStats(orig, dest)
              │      - extract (aircraft_icao, operating_as) buckets
              │      - airport ICAO → IATA via openFlightsService.iataForIcao
              │      - UPSERT into fr24_gf_route_aircraft
              │      - sleep 6s (10 q/min FR24 cap)
              │
              │   3. Write summary row to fr24_gf_ingest_meta
              └────────────────────────────┘
                            ↓
              ┌────────────────────────────┐
              │ fr24_gf_route_aircraft     │ (new, in app.db)
              │ aggregate-gf-prices.js     │ (next spec, out of scope)
              └────────────────────────────┘
```

**Key properties:**

- **Isolated worker** — own script under `server/scripts/`, own log. Does not touch SEO bake or `fr24CacheService.refresh()`.
- **System cron, not pm2** — bypasses cluster-mode leader gating and avoids tying lifetime to pm2 reload cycles.
- **Rate-limit-friendly** — 6 s gap between queries, ~18 min cold-start runtime, ~2.5 min in steady state (most pairs TTL-gated).
- **Idempotent** — UPSERT on PK; rerunning is harmless.
- **Read-side decoupling** — writes only ICAO codes; consumers (next-spec aggregator) map to IATA on read via `openFlightsService.getAirlineByIcao()`. Avoids repeating the `observed_routes.airline_iata`-named-but-stores-ICAO trap.

## Schema

### `fr24_gf_route_aircraft` (new, in `app.db`)

```sql
CREATE TABLE IF NOT EXISTS fr24_gf_route_aircraft (
  dep_iata         TEXT NOT NULL,           -- airport IATA (converted from FR24 ICAO)
  arr_iata         TEXT NOT NULL,
  aircraft_icao    TEXT NOT NULL,           -- type code from FR24 (e.g. B77W, A388)
  airline_icao     TEXT NOT NULL DEFAULT '',-- operating_as from FR24; '' = unknown (NOT nullable — SQLite treats NULL as distinct in PK, would break UPSERT idempotency)
  sample_size      INTEGER NOT NULL,        -- FR24 rows backing this combo (max 20)
  first_seen_at    INTEGER NOT NULL,        -- epoch ms, set on INSERT, never updated
  last_seen_at     INTEGER NOT NULL,        -- epoch ms, refreshed every successful re-query
  PRIMARY KEY (dep_iata, arr_iata, aircraft_icao, airline_icao)
);
CREATE INDEX IF NOT EXISTS idx_fgra_pair ON fr24_gf_route_aircraft(dep_iata, arr_iata);
CREATE INDEX IF NOT EXISTS idx_fgra_fresh ON fr24_gf_route_aircraft(last_seen_at);
```

**Rationale:**

- `airline_icao` is part of PK and stored as `''` for unknown carrier (NOT NULL). Same route+aircraft combo with different carriers gets distinct rows (e.g., `LHR→JFK, B77W`: BAW, AAL, VIR). Aggregator decides cross-mapping later.
- `airline_icao` named honestly: data is ICAO; consumers convert on read.
- `sample_size` weights aggregation — 20-row FR24 sample is biased toward typical aircraft; rare aircraft get sample_size = 1.
- `last_seen_at` is the TTL gate and freshness signal.
- No `source` column — table is FR24-only by design.

### `fr24_gf_ingest_meta` (new, observability)

```sql
CREATE TABLE IF NOT EXISTS fr24_gf_ingest_meta (
  run_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  pairs_total     INTEGER,
  pairs_queried   INTEGER,                  -- pairs that hit FR24
  pairs_skipped   INTEGER,                  -- TTL-gated
  pairs_empty     INTEGER,                  -- FR24 returned 0 rows
  pairs_failed    INTEGER,                  -- 4xx/5xx/timeout
  rows_upserted   INTEGER,
  credits_used    INTEGER,                  -- equals pairs_queried (1 query/pair)
  error_summary   TEXT                      -- nullable; populated only when failures
);
```

Single row per cron run; basis for quick health-check queries.

## Component logic

**Module:** `server/scripts/fr24GfIngest.js` (executable node script, not a long-running worker).

**Dependencies:** `services/fr24Service.fetchRouteStats`, `services/openFlightsService.iataForIcao`, `models/db` (for ATTACH read and UPSERT).

### `main()` flow

```js
async function main() {
  acquireLockOrExit('/tmp/fr24-gf-ingest.lock');

  const startedAt = Date.now();
  const meta = { pairs_total: 0, pairs_queried: 0, pairs_skipped: 0,
                 pairs_empty: 0, pairs_failed: 0, rows_upserted: 0 };

  const pairs = db.attachAndQuery(
    '/root/flightfinder/data/accidents.db',
    'SELECT DISTINCT origin AS dep, destination AS arr FROM gf.flights'
  );
  meta.pairs_total = pairs.length;

  const TTL_MS = 7 * 24 * 3600 * 1000;
  const RATE_MS = 6000;
  const cutoff  = Date.now() - TTL_MS;

  for (const { dep, arr } of pairs) {
    if (db.fr24GfRouteFreshExists(dep, arr, cutoff)) {
      meta.pairs_skipped++;
      continue;
    }

    let stats;
    try { stats = await fr24Service.fetchRouteStats(dep, arr); }
    catch (err) { meta.pairs_failed++; logErr(dep, arr, err); continue; }
    meta.pairs_queried++;

    const rows = extractAircraftRows(stats, dep, arr);
    if (!rows.length) { meta.pairs_empty++; continue; }

    meta.rows_upserted += db.upsertFr24GfRoutes(rows);
    await sleep(RATE_MS);
  }

  db.writeFr24GfIngestMeta({ ...meta, started_at: startedAt, finished_at: Date.now() });
  logCoverageDelta();
  releaseLock();
}
```

### `extractAircraftRows(stats, depInput, arrInput)`

Groups FR24 sample rows by `(aircraft_icao, operating_as)`, returns array ready for UPSERT.

```js
function extractAircraftRows(stats, depInput, arrInput) {
  if (!stats?.rows?.length) return [];
  const buckets = new Map();
  for (const r of stats.rows) {
    const ac = r.aircraft_icao_type || r.type;          // see field-drift mitigation
    const al = r.operating_as || r.operated_as || '';   // '' sentinel for unknown carrier
    if (!ac) continue;
    const key = `${ac}|${al}`;
    if (!buckets.has(key)) buckets.set(key, { ac, al, n: 0 });
    buckets.get(key).n++;
  }
  const now = Date.now();
  return [...buckets.values()].map(b => ({
    dep_iata:      depInput, arr_iata: arrInput,
    aircraft_icao: b.ac,     airline_icao: b.al,
    sample_size:   b.n,
    first_seen_at: now,      last_seen_at: now,
  }));
}
```

### UPSERT SQL

```sql
INSERT INTO fr24_gf_route_aircraft
  (dep_iata, arr_iata, aircraft_icao, airline_icao,
   sample_size, first_seen_at, last_seen_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(dep_iata, arr_iata, aircraft_icao, airline_icao)
DO UPDATE SET
  sample_size  = excluded.sample_size,
  last_seen_at = excluded.last_seen_at;
```

`first_seen_at` is intentionally not in the UPDATE clause — we keep the original first-observation time.

### Rate-limit / budget math

- FR24 Explorer tier: 30,000 credits/month, 10 queries/min (verified — see [`feedback_fr24-explorer-tier-limits`](../../../) memory).
- Cold start: 182 pairs × 1 query × 6 s = ~18 min, 182 credits.
- Steady state: TTL = 7 d, daily cron → ~182/7 ≈ 26 pairs/day active queries → ~780 credits/month = **2.6% of budget**.
- Existing `fr24CacheService.refresh()` consumption (variants + families + top-200-routes) is not affected.

### FR24 field-name drift mitigation

The FR24 `/light` endpoint docs claim `origin_icao` / `operated_as`; production sometimes returns `orig_icao` / `operating_as` (the `/full` schema). Aircraft type field is similarly uncertain — `aircraft_icao_type` per current docs, but unverified in prod responses.

Mitigation: a one-shot probe flag.

```bash
node server/scripts/fr24GfIngest.js --dump-first-row LHR JFK
```

Prints `JSON.stringify(stats.rows[0], null, 2)` and exits, without DB writes. Used during Phase 1 rollout to confirm field names before the first full ingest.

### Lock-file logic

```js
function acquireLockOrExit(path) {
  try { fs.writeFileSync(path, String(process.pid), { flag: 'wx' }); }
  catch (e) {
    if (e.code === 'EEXIST') {
      const pid = parseInt(fs.readFileSync(path, 'utf8'), 10);
      try { process.kill(pid, 0); }                     // probe
      catch { fs.unlinkSync(path); return acquireLockOrExit(path); }
      console.error(`[fr24GfIngest] previous run still active (pid ${pid}), exiting`);
      process.exit(0);                                   // exit 0: cron does not alert
    }
    throw e;
  }
  process.on('exit', () => { try { fs.unlinkSync(path); } catch {} });
}
```

## Deploy & scheduling

### Code deploy

Script + schema migration ship with the FF repo via normal `git push origin main` → automatic VPS deploy (`fetch + reset --hard`, see [`feedback_deploy-uses-fetch-reset-hard`](../../../) memory).

### Cron installation (manual, one-time, on VPS)

```bash
(crontab -l; echo "30 4 * * * cd /root/flightfinder && /root/.nvm/versions/node/v24.14.0/bin/node server/scripts/fr24GfIngest.js >> /var/log/fr24-gf-ingest.log 2>&1") | crontab -
```

- **04:30 UTC daily** — does not overlap with 03:00 UTC app.db backup.
- **Full `node` path** — non-interactive cron has no nvm in PATH (same trap encountered with pm2 on 2026-05-12).
- **`cd /root/flightfinder`** — gives consistent cwd for `require()` resolution and relative DB paths.
- **Log to `/var/log/fr24-gf-ingest.log`** — picked up by default logrotate; greppable from any SSH session.

### Log format

```
[fr24-gf-ingest] 2026-05-13T04:30:00.123Z START pairs_total=182 cutoff=2026-05-06T04:30:00Z
[fr24-gf-ingest] LHR->JFK: queried, 4 buckets, 18 rows -> upserted 4
[fr24-gf-ingest] LHR->FRA: skipped (last_seen_at 2026-05-09)
[fr24-gf-ingest] AMS->ATL: FR24 empty, no aircraft data
[fr24-gf-ingest] CDG->KEF: ERROR fetchRouteStats: 429 rate limit
[fr24-gf-ingest] 2026-05-13T04:48:12.456Z DONE queried=26 skipped=148 empty=5 failed=3 upserted=89 duration=18m12s
[fr24-gf-ingest] coverage: pairs_in_fr24_gf=47/182 (25.8%) after this run; row-ceiling 28.4%
```

### Observability queries

Latest 7 runs:

```bash
ssh himaxym 'sqlite3 -header -column /root/flightfinder/server/data/app.db \
  "SELECT run_id, datetime(started_at/1000,\"unixepoch\") AS started,
          (finished_at-started_at)/1000 AS sec, pairs_queried, pairs_failed,
          rows_upserted, credits_used FROM fr24_gf_ingest_meta
   ORDER BY run_id DESC LIMIT 7;"'
```

Coverage probe (also reported in log after each run):

```sql
SELECT
  (SELECT COUNT(DISTINCT origin||'-'||destination) FROM gf.flights) AS gf_pairs,
  COUNT(DISTINCT f.dep_iata||'-'||f.arr_iata) AS covered_pairs,
  ROUND(100.0 * COUNT(DISTINCT f.dep_iata||'-'||f.arr_iata) /
        (SELECT COUNT(DISTINCT origin||'-'||destination) FROM gf.flights), 1) AS pct
FROM fr24_gf_route_aircraft f;
```

## Failure handling

| Mode | Detection | Response |
|---|---|---|
| FR24 429 rate limit | HTTP status from `fr24Service` | log + skip pair (no TTL update → retry next day) |
| FR24 5xx / network timeout | fetch throw | same as 429 |
| `fr24Service.isEnabled() === false` | early check | exit 1, log "FR24 disabled, set FR24_API_KEY" |
| `gf.flights` empty / accidents.db missing | post-ATTACH `pairs.length === 0` | exit 0, log "no GF pairs, accidents.db stale?" |
| Airport ICAO→IATA lookup fails | `iataForIcao` returns null | skip row, log warn |
| Stale lock file (dead PID) | `process.kill(pid, 0)` throws | unlink and re-acquire |
| Live lock file | PID probe succeeds | exit 0, log "previous run active" |
| FR24 schema drift (no expected fields) | `rows.length > 0` but extracted = 0 | `pairs_empty++`, log warn with raw row sample |
| `pairs_failed / pairs_queried > 0.3` | post-loop check | write `WARN` to `error_summary` in meta row |

No alerting integration. Sentry / PagerDuty are not currently wired into FF for jobs — observability is `fr24_gf_ingest_meta` + the log file. A dashboard alert can be added later if needed.

## Testing

### Unit tests (`server/src/__tests__/fr24GfIngest.test.js`)

| Test | Verifies |
|---|---|
| `extractAircraftRows()` groups by (aircraft, airline) | stubbed FR24 response → correct buckets and `sample_size` |
| `extractAircraftRows()` handles field-name drift | `operated_as` vs `operating_as` → same output |
| `extractAircraftRows()` skips rows without aircraft type | row without `aircraft_icao_type` is omitted |
| TTL gate skips fresh rows | row with `last_seen_at = now` → pair skipped |
| TTL gate re-queries stale rows | row with `last_seen_at = now - 8d` → pair queried |
| UPSERT preserves `first_seen_at` | second INSERT does not modify the column |
| UPSERT replaces `sample_size`, does not accumulate | re-query with 5 rows replaces prior 18, not adds |
| Lock acquire / release / stale | three branches independently |
| Meta row records all counters | run summary written and queryable |

Existing `fr24Service.test.js` provides the mock-fetch pattern; reuse.

### Integration smoke (manual)

1. `FR24_API_KEY=<test_key> node server/scripts/fr24GfIngest.js --dump-first-row LHR JFK` — confirms field names before full run.
2. `node server/scripts/fr24GfIngest.js --limit 3` — 3-pair smoke without burning 18 minutes.
3. Inspect `fr24_gf_route_aircraft` and `fr24_gf_ingest_meta` rows.

## Rollout

| Phase | Action | Gate to proceed |
|---|---|---|
| 0 — schema | Migration adds two tables, no script invocation | `.tables` on prod shows new tables empty |
| 1 — script | Script committed; cron NOT installed. Manual `--dump-first-row` on prod | Field names confirmed, dump matches assumptions |
| 2 — limited run | `--limit 10` on prod, inspect meta and data | Sample data sensible, no schema mismatch |
| 3 — full cold start | Full 182-pair run, ~18 min | Pair-overlap rises from 9.9% → ≥ 75%; if not, root-cause before scheduling |
| 4 — cron install | crontab entry; monitor `fr24_gf_ingest_meta` daily for 3 days | failure rate < 10%, credits/day stable |

## Success criteria

| Metric | Target |
|---|---|
| `pairs_total` per run | = `SELECT DISTINCT count` from `gf.flights` (~182) |
| `pairs_failed / pairs_queried` after first week | < 10% |
| Pair coverage (`gf.flights` ↔ `fr24_gf_route_aircraft`) | ≥ 75% (137+/182) |
| Row-level match ceiling | ≥ 70% (8,000+ of 11,845 GF rows covered) |
| FR24 credits / month in steady state | < 1,000 (< 3% of 30K budget) |
| Cron drift (run-to-run interval) | 24 h ± 5 min |

## Rollback

If rollout breaks anything in subsequent phases:

1. `crontab -r` (or comment the line) — stops scheduling.
2. Optionally `DROP TABLE fr24_gf_route_aircraft; DROP TABLE fr24_gf_ingest_meta;` — but more likely just leave them empty.
3. No existing FF functionality depends on the new tables until a future spec (`aggregate-gf-prices.js`) lands → blast radius is zero on currently-shipped features.

# ADS-B Routeset Fix: Live Map Ingest Recovery

**Date:** 2026-05-19
**Status:** Approved, ready for plan
**Owner:** Denys

## Problem

The interactive flight map at `https://himaxym.com/map` looks sparse to end users. Investigation of production state on 2026-05-19 (Hetzner box, post-migration) shows:

- `observed_routes` table: 4,517 rows total. Last write **2026-05-05 19:57 UTC** — 14 days stale.
- 95% of rows (4,293) came from a single bulk cycle on 2026-04-21; only 29 rows tagged `source='live'`.
- Live worker `adsblolWorker` is up and looping every 20 min, but every cycle logs `cycle done types=48 resolved=0 persisted=0`.
- `/api/map/routes` (90-day window) currently returns 3,091 city-pairs covering only 896 of 6,072 airports.

**Root cause** (verified with direct curl from the prod IP):

| adsb.lol endpoint                          | Status                                   |
|--------------------------------------------|------------------------------------------|
| `GET /v2/type/{icao_type}`                 | ✅ HTTP 200, ~800 aircraft per type      |
| `POST /api/0/routeset` (the resolver)      | ❌ HTTP 201, **0-byte body**, `text/html` |
| `GET /v2/routeset`                         | HTTP 404 (not migrated to v2)            |
| `GET /api/0/route/{callsign}`              | HTTP 302 redirect (deprecated)           |

`server/src/services/adsblolService.js:102-103` parses the empty response as `Array.isArray(undefined) === false → rows = []`. axios does not throw on HTTP 201, so the worker logs `persisted=0` with no warning. This has been silently failing since the adsb.lol endpoint change.

## Goal

Restore live route ingest by replacing the broken adsb.lol routeset call with **adsbdb.com**'s per-callsign endpoint, plus add observability so the next such silent failure surfaces.

**Success criteria:**
1. `observed_routes` grows by ≥ 500 distinct `(dep, arr, aircraft_icao)` rows in the first hour after deploy.
2. `/api/admin/ingest-status` exposes `observedRoutes.newest_seen_at` and `adsblolLastCycle.{ran_at, fetched, resolved, persisted}`.
3. A cycle that fetches aircraft but persists zero rows logs a `WARN` line containing the literal token `silent-fail tripwire`.
4. After 24h of running, `/api/map/routes` returns ≥ 5,000 city-pairs covering ≥ 1,500 unique airports.
5. No regression in existing tests; existing `observed_routes` data is preserved.

## Non-goals

- Active alerting (email/Telegram). Admin endpoint is the surface; user pulls it via cron-curl out of band.
- Switching from adsb.lol entirely. The `/v2/type/{icao}` endpoint still works and is our aircraft discovery source.
- Adding OpenSky Network or commercial ADS-B feeds as additional sources.
- Backfilling historical routes from third-party dumps (e.g., reseed jonty routes table).
- Schema changes to `observed_routes`.

## Approach

### 1. New service: `adsbdbService.js`

Single-purpose wrapper around `https://api.adsbdb.com/v0/callsign/{callsign}`.

**Public API:**

```js
adsbdbService.resolveCallsign(callsign: string)
  → Promise<{
      depIata:    string,   // 3-letter
      arrIata:    string,
      depIcao:    string|null,
      arrIcao:    string|null,
      airlineIata: string|null,
      airlineIcao: string|null,
    } | null>
adsbdbService.isEnabled()  → boolean   // gated by ADSBDB_ENABLED env, default '1'
```

**Behavior:**

- **Persistent cache**: SQLite table `adsbdb_callsign_cache` (see "Data model" below). Reads hit cache when `expires_at > Date.now()`.
- **Network call**: `axios.get('https://api.adsbdb.com/v0/callsign/' + cs, { timeout: 10000, httpsAgent: keepAliveAgent })`.
- **200 OK**: parse `response.flightroute.{origin,destination,airline}`, persist to cache with `expires_at = now + 7d`, return resolved object.
- **404 Not Found**: persist a NEGATIVE cache row (`dep_iata=NULL`) with `expires_at = now + 1d`, return `null`.
- **429 Too Many Requests**: `await sleep(10_000)`, retry once, then warn and return `null` (no cache poison).
- **Other 4xx/5xx/network**: warn, return `null`, do not cache.
- **Concurrency**: keep-alive agent with `maxSockets: 4` (polite to adsbdb).

### 2. Modify `adsblolService.js`

Replace the broken `resolveRoutes(planes)`:

```js
// new implementation — sketch
exports.resolveRoutes = async (planes) => {
  if (!exports.isEnabled()) return [];
  const out = [];
  const queue = [...planes];
  const workers = Array.from({ length: ADSBDB_CONCURRENCY }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const r = await adsbdbService.resolveCallsign(p.callsign);
      if (!r) continue;
      out.push({
        callsign: p.callsign,
        depIata: r.depIata, arrIata: r.arrIata,
        depIcao: r.depIcao, arrIcao: r.arrIcao,
        airlineCode: r.airlineIcao || r.airlineIata || null,
      });
      await sleep(ADSBDB_PER_REQUEST_DELAY_MS);
    }
  });
  await Promise.all(workers);
  return out;
};
```

**Constants:**
- `ADSBDB_CONCURRENCY = 4`
- `ADSBDB_PER_REQUEST_DELAY_MS = 250` (effective ~16 req/s, well under typical rate limits)

`pullAndPersistType` is unchanged — it consumes the same shape `resolveRoutes` already returned, so the upsert path stays identical.

### 3. Silent-fail tripwire (still in `adsblolService.js`)

Inside `pullAndPersistType`, after the loop:

```js
if (planes.length > 0 && persisted === 0) {
  console.warn(`[adsblol] silent-fail tripwire: type=${type} fetched=${planes.length} resolved=${routes.length} persisted=0 — adsbdb may be down or returning negatives`);
}
```

The token `silent-fail tripwire` is documented in success criteria #3 so future ops can `grep` for it.

### 4. Modify `adsblolWorker.js`

Two changes:

a. **Boot-trigger seed.** Replace `INITIAL_DELAY_MS = 2 * 60 * 1000` with `INITIAL_DELAY_MS = 5_000`. First cycle starts ~5s after `pm2 reload`, gives the new SSR/index server time to bind without colliding with the inbound burst.

b. **Last-cycle metrics singleton.** Export a getter:

```js
let lastCycle = { ran_at: null, fetched: 0, resolved: 0, persisted: 0, duration_ms: 0, types: 0 };
exports.getLastCycle = () => ({ ...lastCycle });
```

`runCycle()` populates `lastCycle` at the end of each pass. Returns the same getter that `/api/admin/ingest-status` consumes (no global state via module-level export — single source of truth).

### 5. DB migration: `adsbdb_callsign_cache`

`server/src/models/db.js` `ensureSchema()`:

```sql
CREATE TABLE IF NOT EXISTS adsbdb_callsign_cache (
  callsign      TEXT PRIMARY KEY,         -- normalized uppercase, trimmed
  dep_iata      TEXT,                     -- NULL means "no route" (negative cache)
  arr_iata      TEXT,
  dep_icao      TEXT,
  arr_icao      TEXT,
  airline_iata  TEXT,
  airline_icao  TEXT,
  resolved_at   INTEGER NOT NULL,         -- ms
  expires_at    INTEGER NOT NULL          -- ms; cache hit iff expires_at > Date.now()
);
CREATE INDEX IF NOT EXISTS idx_adsbdb_callsign_expires ON adsbdb_callsign_cache(expires_at);
```

Migration is idempotent (`IF NOT EXISTS`), no backfill, safe to deploy.

Periodic GC (every 24h, leader-only) deletes rows where `expires_at < Date.now() - 30d` to keep the table from growing unbounded. Hook into existing `dbMaintenanceWorker.js` rather than adding a new worker.

### 6. Extend `routes/ingestStatus.js`

Add to the existing response (auth/format unchanged):

```json
{
  "observedRoutes": {
    "total":             4517,
    "last24h":           0,
    "last7d":            0,
    "last30d":           4517,
    "oldest_seen_at":    1776684938452,
    "newest_seen_at":    1778011050221
  },
  "adsblolLastCycle": {
    "ran_at":      1779000000000,
    "duration_ms": 184321,
    "types":       48,
    "fetched":     38214,
    "resolved":    12903,
    "persisted":   874
  },
  "adsbdbCache": {
    "total":            12903,
    "resolved":         11400,
    "negative":         1503,
    "expired_unswept":  0
  }
}
```

`adsblolLastCycle` is read from `adsblolWorker.getLastCycle()`. `adsbdbCache` is a single `SELECT COUNT(*)` per bucket against `adsbdb_callsign_cache`.

## Data model

| Table                       | Action  | Notes                                                              |
|-----------------------------|---------|--------------------------------------------------------------------|
| `observed_routes`           | none    | existing schema fits; new rows tagged `source='live'`              |
| `adsbdb_callsign_cache`     | CREATE  | new persistent cache, idempotent migration                         |

No backfill, no destructive ops, no breaking changes.

## Cycle data flow (post-fix)

```
worker tick (every 20m, first cycle at +5s after boot):
  metrics = { fetched:0, resolved:0, persisted:0, t0:Date.now() }
  for type in AIRCRAFT_TYPES (48):
    planes = adsblolService.getAircraftByType(type)        // adsb.lol /v2/type, 10m memcache
    metrics.fetched += planes.length
    if planes.length == 0: continue
    routes = adsblolService.resolveRoutes(planes)          // ← NEW path via adsbdb + SQLite cache
    metrics.resolved += routes.length
    for r in routes:
      observed_routes.upsert(r.depIata, r.arrIata, type, r.airlineCode, source='live')
      metrics.persisted++
    if planes.length > 0 && persisted_this_type == 0:
      console.warn('[adsblol] silent-fail tripwire ...')
    sleep(3s)                                              // existing per-type spacing
  metrics.duration_ms = Date.now() - metrics.t0
  metrics.ran_at = Date.now()
  adsblolWorker.lastCycle = metrics
  console.log(`[adsblol] cycle done types=48 fetched=${metrics.fetched} resolved=${metrics.resolved} persisted=${metrics.persisted}`)
```

## Error handling matrix

| Failure                              | Behavior                                                                  | User-visible             |
|--------------------------------------|---------------------------------------------------------------------------|--------------------------|
| adsb.lol `/v2/type` 5xx/timeout      | warn, skip type, cycle continues (existing behavior)                       | type contributes 0 rows  |
| adsbdb `/v0/callsign` 404            | cache negative (1d), return null                                          | callsign skipped         |
| adsbdb 429                           | sleep 10s, retry once, then skip                                          | warn line                |
| adsbdb 5xx / network error           | warn, skip, no cache (next cycle retries)                                 | warn line                |
| `fetched>0 && persisted=0` per cycle | `console.warn('[adsblol] silent-fail tripwire ...')`                       | grep-able in pm2 logs    |
| DB write fails                       | catch + warn (existing behavior); cycle continues                          | persisted counter lower  |

Worker loop never throws — preserved from current code.

## Testing

All Jest, `NODE_ENV=test` uses `:memory:` SQLite (per [[reference_flightfinder-paths]]).

**Unit:**

1. `adsbdbService.test.js` — mock axios:
   - 200 → returns parsed shape, writes resolved cache row with `expires_at ≈ now+7d`
   - 404 → returns null, writes negative cache row with `expires_at ≈ now+1d`
   - 429 → sleeps, retries once, returns null on second 429
   - cache hit before expiry → no axios call
   - cache miss after expiry → axios called, cache row updated
   - `ADSBDB_ENABLED=0` → returns null without axios

2. `adsblolService.routes.test.js`:
   - `resolveRoutes` calls `adsbdbService.resolveCallsign` for each plane
   - returns expected `{callsign, depIata, arrIata, ...}` shape
   - skips null resolutions
   - `pullAndPersistType` upserts rows with `source='live'`

3. `adsblolService.tripwire.test.js`:
   - fetched=10 persisted=0 → warn called with literal `silent-fail tripwire`
   - fetched=0 → no warn
   - fetched=10 persisted=1 → no warn

4. `ingestStatus.adsblol.test.js`:
   - response includes `observedRoutes.newest_seen_at`, `last24h`, `last7d`
   - response includes `adsblolLastCycle.{ran_at, fetched, resolved, persisted, duration_ms, types}`
   - response includes `adsbdbCache.{total, resolved, negative}`

**Integration:**

5. `adsblolWorker.cycle.test.js` — run one cycle against mocked adsb.lol + adsbdb services with deterministic fixtures, assert `observed_routes` ends with the expected upsert set.

## Deployment

1. Merge to `main` → pm2 reload triggers (per [[reference_flightfinder-paths]]).
2. `ADSBDB_ENABLED=1` to `/root/flightfinder/server/.env` (default-on in code, env is the kill switch).
3. After reload, first cycle should fire within ~5s and log `[adsblol] cycle done types=48 fetched=...` with `persisted>0`.
4. Verify: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://himaxym.com/api/admin/ingest-status | jq '.observedRoutes,.adsblolLastCycle'` → `newest_seen_at` close to deploy time, `persisted>0`.

## Rollback

If anything regresses:
- `ADSBLOL_ENABLED=0` in `.env` + pm2 reload → worker logs `[adsblol] disabled` and no writes happen.
- Or revert the deploy commit; `adsbdb_callsign_cache` table remains (harmless, no FK).

## Open items

None — backfill scope chose "boot-trigger seed"; diagnostics chose "admin status endpoint"; persistent SQLite cache chosen for restart-survival.

## References

- Investigation: this session, 2026-05-19
- Memory: [[feedback_systemd-disabled-units-trap]] — same pattern of "looks alive, silent under the hood"
- Code: `server/src/{services/adsblolService.js,workers/adsblolWorker.js,routes/ingestStatus.js,models/db.js,models/observedRoutes.js}`
- External: `https://api.adsbdb.com/v0/callsign/{callsign}` — ODbL community service

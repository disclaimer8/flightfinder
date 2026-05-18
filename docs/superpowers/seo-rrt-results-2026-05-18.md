# SEO Phase 2 — Validation Evidence (Wave 0+, 2026-05-18)

## A.1 — Rich Results Test for Phase 1 URLs

(Pending — user runs manually in Wave 0)

## A.2 — Sitemap submission

(Pending — user runs manually in Wave 0)

## A.3 — Baseline impressions

(Pending — user runs manually in Wave 0)

## B2 coverage SQL result

- Total distinct FF carriers (ICAO from observed_routes): 399
- After ICAO→IATA mapping: 215
- Unmapped (no openflights ICAO match): 187
- Jonty-covered (subset of mapped): 182
- **Coverage pct: 84.7%**
- Decision: **Path B (patch airlineMeta only)** — coverage clearly below 93% threshold; no gray-zone confirmation needed.

### Schema note (deviation from spec)

The spec assumed `app.db` contained an openflights `airlines` table with `icao`/`iata` columns. It does not — app.db has no `airlines` table at all (only `airline_amenities` and `airline_liveries`). The openflights master data lives in a flat file at `server/src/data/airlines.dat`, loaded into in-memory Maps by `openFlightsService.js` (`airlinesIcaoMap` for ICAO→IATA reverse lookup; filter rules: `iata.length >= 2 AND active === 'Y'`).

To run the SQL coverage query, I built a temp SQLite table on prod (`/tmp/airlines_mapping.db`) from `airlines.dat`, applying the same filter (1014 active airlines, 987 with non-empty ICAO). All four coverage/diagnostic queries then ran against this temp DB with `app.db` and `jonty.db` attached. This faithfully reproduces the in-app `getAirlineByIcao` mapping.

### Sample of mapped-but-not-in-jonty carriers

| ICAO | IATA | Name |
| --- | --- | --- |
| SLI | 5D | Aerolitoral |
| ABQ | ED | Airblue |
| ARE | 4C | Aires |
| SDM | FV | Rossiya-Russian Airlines |
| GAP | 2P | Air Philippines |
| GTI | 5Y | Atlas Air |
| JZA | QK | Air Canada Jazz |
| LNE | XL | Aerolane |
| GLG | 2K | Aerolineas Galapagos (Aerogal) |
| BMA | BD | bmi |

Sample is plausible — real airline names with recognisable codes. Notable: several are defunct or renamed (bmi merged into BA 2012; Aires merged into Avianca; Aerogal rebranded to Avianca Ecuador; Atlas Air is a cargo operator, jonty appears to be passenger-only). So the 33-carrier gap (215 mapped − 182 covered) is dominated by cargo + defunct/merged + small regional carriers. This is consistent with jonty being a passenger-scheduling dataset.

### Why mapping loss is the dominant factor

Of 399 distinct FF carriers in `observed_routes`, **187 (47%) failed ICAO→IATA mapping** in the first place — i.e. their ICAO code isn't in OpenFlights' active-airlines list. These are likely military, charter, ADS-B-spoofed, or defunct operators with stale ICAO codes still in our 30-day rolling window. They never had a chance to land in jonty.

The 84.7% figure is therefore the coverage of the *mappable* subset; the union-coverage of ALL FF carriers against jonty would be far lower (~46%). Either way, **Path B is unambiguous**: we can't retire bAirline because too many real ADS-B-observed carriers wouldn't have a jonty fallback.

### SQL run timestamp

2026-05-18T16:41:06Z



## B7 — Deploy webhook fix

- Handler location: `.github/workflows/deploy.yml` (GitHub Actions, push-on-main → `appleboy/ssh-action` to `origin.himaxym.com` as root). No server-side webhook script; deploy is driven by the workflow itself.
- Gap found: `reload→restart`. Line 327 used `pm2 startOrReload ecosystem.config.js --update-env`. `startOrReload` performs a graceful reload, which keeps the Node `require()` module cache alive across the process swap — so updated modules (e.g. `server/src/services/seoContentBuilders.js`) ship stale until a manual `pm2 restart`. PATH was already fine (workflow sources nvm via `$NVM_DIR/nvm.sh`, putting pm2 on PATH).
- Fix applied: yes — changed `pm2 startOrReload` → `pm2 startOrRestart` in `.github/workflows/deploy.yml` (commit `410ff9a`), with an inline comment explaining why, citing the Phase 1 SEO ship lesson + memory notes. Full process respawn invalidates the require() cache.
- Verified: pushes to `origin/main` now trigger full pm2 restart without manual intervention.
  - **Before fix:** cluster worker ids `9, 10`, uptime `18h`, restart counter `0`.
  - **After fix push (commit `410ff9a`):** worker ids `11, 12`, uptime `13s`, restart counter `0` (new processes, not incremented existing — this is the correct restart-vs-reload signature: reload would have kept ids 9+10 and bumped `↺` to 1; restart deletes+recreates).
  - **After empty-commit verification push (commit `cf57499`):** worker ids `13, 14`, uptime `15s`. Confirms repeatable auto-restart on each push.
  - `curl https://himaxym.com/sitemap.xml` returns valid XML after both deploys (no 502).
- GitHub Actions deploy run times: 25s and 24s for the two pushes (down from previous ~70s, npm cache warm).

## B3 — route_carriers(carrier_iata, origin_iata) composite index

- sync-jonty.js updated: yes (line 53) — inline in `SCHEMA` template literal, matching style of sibling `idx_airports_country` (line 35) and `idx_routes_dest` (line 44).
- Production rollout: `DROP INDEX idx_route_carriers_carrier; CREATE INDEX idx_route_carriers_carrier ON route_carriers(carrier_iata, origin_iata);` on `/var/lib/flightfinder/data/jonty.db`. Total time **87ms** (atomic for traffic purposes).
- Index name preserved (`idx_route_carriers_carrier`) — column list changed only. Name is intentionally not renamed despite being technically misleading (now composite, name implies single-col); rename would break grep continuity across docs/memory + require coordinated rebuild.
- Choice rationale: composite serves both `WHERE carrier_iata = ?` (via leftmost-prefix) AND `WHERE carrier_iata = ? AND origin_iata = ?` (full match). The latter pattern dominates lazy bakes for /airline/:iata/from/:airport (more URLs than /airline/:iata alone — predicate in `airlineAirportBuilder.js:20`).
- Write cost during sync: accepted — bulk insert inside single transaction; index update cost is low-seconds on ~50K-100K rows; deferred-index pattern rejected (adds failure modes for marginal savings).
- Auto-restart witness for composite-upgrade push (commit `0fd191d`): pm2 worker ids `19, 20` → `21, 22`, uptime ~2m post-deploy, restart counter `0` (correct full-respawn signature). Confirms B7 fix is still functioning under feature pushes.

### EXPLAIN QUERY PLAN — `WHERE carrier_iata = ?`
```
QUERY PLAN
`--SEARCH route_carriers USING INDEX idx_route_carriers_carrier (carrier_iata=?)
```

### EXPLAIN QUERY PLAN — `WHERE carrier_iata = ? AND origin_iata = ?`
```
QUERY PLAN
`--SEARCH route_carriers USING INDEX idx_route_carriers_carrier (carrier_iata=? AND origin_iata=?)
```


## Wave 2 Path B — airlineMeta jonty-aware smoke

Pushed commit: 75f54f2 (`feat(seo): Path B — airlineMeta is jonty-aware when data exists`)

pm2 workers before push: PIDs 76363, 76375 (worker IDs 25, 26)
pm2 workers after push:  PIDs 78642, 78662 (worker IDs 27, 28) — auto-restart confirmed.

Smoke (Googlebot UA, https://himaxym.com):

| URL | `<title>` | `<h1>` (first/SSR) | jonty hit? | Match body? |
|---|---|---|---|---|
| /airline/LH | `Lufthansa (LH) — route network (620 routes) \| FlightFinder` | `Lufthansa route network` | YES | YES |
| /airline/BA | `British Airways (BA) — route network (545 routes) \| FlightFinder` | `British Airways route network` | YES | YES |
| /airline/AA | `American Airlines (AA) — route network (2725 routes) \| FlightFinder` | `American Airlines route network` | YES | YES |
| /airline/DL | `Delta Air Lines (DL) — route network (2101 routes) \| FlightFinder` | `Delta Air Lines route network` | YES | YES |
| /airline/EK | `Emirates (EK) — route network (288 routes) \| FlightFinder` | `Emirates route network` | YES | YES |
| /airline/QK | `Air Canada Jazz (QK) — routes, fleet, destinations \| FlightFinder` | `Air Canada Jazz — destinations and fleet` | NO (fallback) | YES (SSR h1); see note |

**Result:** Phase 1 mismatch resolved — for jonty-covered carriers, title and h1 now both say "X route network" (matching the body's route table). Carriers absent from jonty (like QK) keep the OpenFlights name + bAirline content path with the old "routes, fleet, destinations" copy.

**Note on QK double-h1:** /airline/QK has a stale second body-level `<h1>QK — destinations and fleet</h1>` from the bAirline fallback path — a pre-existing rendering issue (IATA-only h1 inside bAirline's innerHtml), independent of Path B. SSR `<h1>` (the one Google sees first) is correct. Tracked separately if it bites.

**Tests:** 1259 passing, 0 failing, 6 skipped (Phase 1 baseline was 1257; +2 from Path B tests).

## Wave 2 Path B follow-up (code review fixes)

Pushed commit: 8718854

- I1 (error handling): jonty try/catch now allowlists operational failures (jonty.db missing, schema drift, SQLITE_*), rethrows real bugs in non-prod, warns in prod. Mirrors sibling pattern at `seoContentBuilders.js:1364-1379`.
- I2 (query weight): new `getCarrierMeta()` helper uses `WHERE carrier_iata = ? GROUP BY carrier_name ORDER BY routeCount DESC LIMIT 1` instead of the full 4-table JOIN in `getAirlineNetwork()`. Leverages composite index `idx_route_carriers_carrier(carrier_iata, origin_iata)` from B3 — cuts cold-cache cost dramatically on large carriers (~2700 rows for AA → single aggregate row).
- I3 (test rigor): fixture seeded with `British Airways Plc` and `Deutsche Lufthansa AG` (intentionally different from OpenFlights' `British Airways` / `Lufthansa`) + route-count assertion `route network \(1 routes\)` + 3rd LH test. 1260 tests passing.
- P1 (bAirline h1): IATA-only fallback fixed — `<h1>${esc(meta.airlineName || iata)} — destinations and fleet</h1>`. Verified live below.

### Re-smoke /airline/QK after P1

```
$ curl -sA 'Googlebot' "https://himaxym.com/airline/QK" | grep -oE '<h1>[^<]+</h1>'
<h1>Air Canada Jazz — destinations and fleet</h1>
```

Single h1 with carrier name (was `<h1>QK — destinations and fleet</h1>` before). The shell+body h1s now agree, so the previous double-h1 mismatch noted in the Phase 1 smoke is resolved.

### Re-smoke /airline/BA (jonty path) confirms I2 didn't regress

```
$ curl -sA 'Googlebot' "https://himaxym.com/airline/BA" | grep -oE '<title>[^<]+</title>'
<title>British Airways (BA) — route network (545 routes) | FlightFinder</title>
```

545 routes — same as before I2 (full network length and dominant carrier_name). New `getCarrierMeta()` returns identical name+count vs the old JOIN+for-loop.

### pm2 IDs after push (auto-restart)

- Before: 29, 30 (stopping)
- After: 31, 32 (online, uptime ~5s when checked)

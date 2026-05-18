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

## Wave 3a — Alliance smoke

Pushed commits ending at `19c875f`. Sitemap shows 3 /alliance/* URLs (expected 3).

| URL | HTTP | <title> | <h1> | Schemas |
|---|---|---|---|---|
| /alliance/star-alliance | 200 | `Star Alliance — 24 member airlines | FlightFinder` | `Star Alliance — airline alliance` | Organization, BreadcrumbList, FAQPage |
| /alliance/oneworld | 200 | `Oneworld — 15 member airlines | FlightFinder` | `Oneworld — airline alliance` | Organization, BreadcrumbList, FAQPage |
| /alliance/skyteam | 200 | `SkyTeam — 20 member airlines | FlightFinder` | `SkyTeam — airline alliance` | Organization, BreadcrumbList, FAQPage |

Sitemap entries:

```
https://himaxym.com/alliance/star-alliance
https://himaxym.com/alliance/oneworld
https://himaxym.com/alliance/skyteam
```

### pm2 IDs after deploy
- Before: 33, 34 (stopping)
- After: 35, 36 (online, uptime ~5s when checked)

## Wave 3a follow-up — data corrections + correctness + performance

Pushed commit: `021b2b5`

### Membership corrections (C1)
Verified each list against Wikipedia (official alliance sites
staralliance.com and skyteam.com returned 403 to WebFetch). Every IATA
cross-checked against `server/src/data/airlines.dat`.

- **Star Alliance** (24 → 26)
  - Removed: `EW` (Connecting Partner, not full member), `JP` (Adria Airways, defunct 2019)
  - Added: `NZ` Air New Zealand, `AI` Air India, `OU` Croatia, `A3` Aegean, `AZ` ITA Airways (transitioned from SkyTeam)
  - Hubs: removed SVO (Aeroflot's hub, irrelevant)
- **Oneworld** (15 → 16)
  - Removed: `S7` (suspended April 2022 post-Ukraine invasion)
  - Added: `WY` Oman Air (joined 30 Jun 2025), `HA` Hawaiian Airlines (joined 23 Apr 2026)
- **SkyTeam** (20 → 18)
  - Removed: `SU` Aeroflot (suspended April 2022), `ZM` (was "Apache Air" — typo, no SkyTeam member with code ZM), `CZ` (China Southern left Dec 2018), `AZ` (Alitalia ceased; ITA transitioned to Star)
  - Added: `SK` SAS (joined Sep 2024), `SV` Saudia, `MF` XiamenAir
- Every alliance has a new `source` field with the verification URL and date.

### Route dedup (C2)
- Star Alliance — Before (sum of per-carrier rows): **10711** non-stop routes. After (unique origin/dest pairs): **9702** unique non-stop routes. Diff = 1009 codeshare routes that were previously double-counted.
- Oneworld — After: **6581** unique non-stop routes across 925 destinations
- SkyTeam — After: **7463** unique non-stop routes across 964 destinations
- FAQ + intro copy now reads "unique non-stop routes" (not "non-stop routes") to avoid flight-count ambiguity.

### Performance (I1)
- Old: 24× `getAirlineNetwork` per cold bake — each a 4-table JOIN returning every (origin, dest, carrier, route, airport_o, airport_d) row.
- New: 24× `getCarrierMeta` (LIMIT 1, indexed) + 24× `getCarrierDestinations` (DISTINCT origin/dest only).
- Both queries use the `idx_route_carriers_carrier(carrier_iata, origin_iata)` composite index from B3.

### Name fallback (I2)
- `allianceBuilder.js` now requires `openFlightsService` and falls back to `openFlights.getAirline(iata).name` when jonty has no rows for a member. Bare IATA is the last resort.

### Grammar (I3)
- `routeLabel(n)` helper renders `1 route` vs `N routes`. Applied to member `<li>` and FAQ destinations answer.

### Sitemap priority (I4)
- `/alliance/*` priority bumped `0.5 → 0.6` to match Phase 1 jonty pillars (`/airline/:iata`, `/flights-from/:iata`).

### Tests
- Full suite: **1266 passing, 0 failing, 6 skipped** (unchanged from baseline).
- Targeted: `seoBuilders.alliance` 5/5 PASS, `builderEnumeratorCoupling` 4/4 PASS.

### Production smoke (Googlebot UA)
```
/alliance/star-alliance → <title>Star Alliance — 26 member airlines | FlightFinder</title>
                         approximately 9702 unique non-stop routes across 1205 destinations.
/alliance/oneworld     → <title>Oneworld — 16 member airlines | FlightFinder</title>
                         approximately 6581 unique non-stop routes across 925 destinations.
/alliance/skyteam      → <title>SkyTeam — 18 member airlines | FlightFinder</title>
                         approximately 7463 unique non-stop routes across 964 destinations.
```
Sitemap re-verified: all three `/alliance/*` entries now `<priority>0.6</priority>`.

### pm2 IDs after deploy
- Before: 37, 38
- After: 39, 40 (online, uptime ~5s when smoked)

## Wave 3b — Country pages smoke

Pushed commits ending at 30b9caf.

Sitemap country URL count: 236 (expected 200-250 per jonty.airports DISTINCT country_code)

| URL | HTTP | <title> | <h1> |
|---|---|---|---|
| /country/US | 200 | Flights from United States — airports, airlines, popular routes \| FlightFinder | United States — aviation overview |
| /country/DE | 200 | Flights from Germany — airports, airlines, popular routes \| FlightFinder | Germany — aviation overview |
| /country/JP | 200 | Flights from Japan — airports, airlines, popular routes \| FlightFinder | Japan — aviation overview |
| /country/FR | 200 | Flights from France — airports, airlines, popular routes \| FlightFinder | France — aviation overview |
| /country/GB | 200 | Flights from United Kingdom — airports, airlines, popular routes \| FlightFinder | United Kingdom — aviation overview |
| /country/CN | 200 | Flights from China — airports, airlines, popular routes \| FlightFinder | China — aviation overview |
| /country/IN | 200 | Flights from India — airports, airlines, popular routes \| FlightFinder | India — aviation overview |
| /country/BR | 200 | Flights from Brazil — airports, airlines, popular routes \| FlightFinder | Brazil — aviation overview |
| /country/CA | 200 | Flights from Canada — airports, airlines, popular routes \| FlightFinder | Canada — aviation overview |
| /country/AU | 200 | Flights from Australia — airports, airlines, popular routes \| FlightFinder | Australia — aviation overview |

### Schema verification (curl /country/US)
- Place schema (NOT Country): confirmed — `"@type":"Place"` present, `"@type":"Country"` count = 0
- No Vehicle/Product warnings (no such types emitted by builder)
- BreadcrumbList + ListItem (×3) present
- FAQPage + Question/Answer (×3) present

Verbatim `@type` order in /country/US response:
```
"@type": "WebSite"
"@type": "Organization"
"@type": "SearchAction"
"@type": "EntryPoint"
"@type": "SoftwareApplication"
"@type": "Offer"
"@type":"Place"
"@type":"BreadcrumbList"
"@type":"ListItem"
"@type":"ListItem"
"@type":"ListItem"
"@type":"FAQPage"
"@type":"Question"
"@type":"Answer"
"@type":"Question"
```

### Canonical-URL note
Sitemap emits lowercase `/country/<cc>` (via `lc(u)` matching alliance pattern). The resolver regex `/i` is case-insensitive; lowercase requests return 200 with `<link rel="canonical" href="https://himaxym.com/country/US">` pointing to the uppercase canonical form. Google consolidates via canonical, so this is acceptable.

### Index applied on prod
`idx_airports_country` already in SCHEMA (sync-jonty.js:35). Re-applied IF NOT EXISTS on prod jonty.db (real path `/var/lib/flightfinder/data/jonty.db`) — EXPLAIN QUERY PLAN confirms `SEARCH airports USING INDEX idx_airports_country (country_code=?)`. No file change for Commit 1 (no-op).

### pm2 IDs after deploy
- Before: 41, 42
- After: 43, 44 (online, uptime ~55s when smoked)

## Wave 3b follow-up — soft-404 fix (I1) + test strengthening (M5)

Pushed commit: 16cb1b5

### I1 fix
- countryMeta now gates on a lightweight `SELECT 1 FROM airports WHERE country_code = ? LIMIT 1` query (cheaper than full getCountryStats; <0.5ms via idx_airports_country) and returns null for unbacked ISO codes
- resolver country branch updated to fall through to not-found when meta returns null
- Operational jonty failures (jonty.db missing / no such table / SQLITE_*) allowlisted to fall through permissively so sync windows don't 404 the page

Pre-fix prod (captured before push):
- `/country/ZZ`: HTTP 200, `<title>Flights from Unknown Region — airports, airlines, popular routes | FlightFinder</title>`
- `/country/AQ`: HTTP 200, `<title>Flights from Antarctica — airports, airlines, popular routes | FlightFinder</title>`
- `/country/US`: HTTP 200, `<title>Flights from United States — ...</title>` (sanity)

Post-fix prod:
- `/country/ZZ`: HTTP 404, fallback default title
- `/country/AQ`: HTTP 404, fallback default title
- `/country/XA`: HTTP 404
- `/country/XX`: HTTP 404
- `/country/US`: HTTP 200, `<title>Flights from United States — ...</title>` (no regression)
- `/country/DE`: HTTP 200, `<title>Flights from Germany — ...</title>`
- `/country/JP`: HTTP 200, `<title>Flights from Japan — ...</title>`

### Test strengthening (M5)
- `seoBuilders.country.test.js` test "builder produces inner <main> HTML with top airports list (city names)" now asserts both `/New York/` and `/Los Angeles/` (city-name fallback path) plus the IATA codes — was masked by loose `/JFK|LAX/` regex that accidentally matched IATA codes appearing in parens
- Fixture adds `LAX→JFK` route so LAX surfaces in topAirports (only origin airports show up in the list)
- Test 4 renamed "resolver returns null/not-found for country with no airports" now asserts resolver-level null for both ZZ + AQ (was builder-level only)

### Test counts
- Country suite: 5/5 PASS (2 strengthened)
- Full suite: 1275 passed, 0 failed, 6 skipped (no count change vs Wave 3b baseline)

### pm2 IDs after deploy
- Before: 45, 46
- After: 47, 48 (online, uptime ~8s when smoked)

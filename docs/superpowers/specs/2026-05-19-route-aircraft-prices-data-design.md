# Route × Aircraft Prices — Data Layer Design (Spec A)

**Date:** 2026-05-19
**Status:** approved, pending implementation plan
**Successor to:** `2026-05-12-fr24-gf-route-ingest-design.md` (Path A pause memory: `[[project_aircraft-price-widget]]`)
**Companion spec:** Spec B (UI + SEO bake) — separate doc, written after Spec A ships and ~2 weeks of data accumulate

## Problem

We have two scraped datasets sitting on prod with no consumer:
- `gf.flights` on mini-PC (84,005 Google Flights quotes, 6+ days continuous scrape) — has prices but no aircraft type
- `fr24_gf_route_aircraft` on hetzner (729 buckets across 23 pairs after 8 ingest runs) — has aircraft buckets but no prices

The data-layer joining them — `aggregate-gf-prices.js` — was never written. Without it, there's no `route_aircraft_prices` table to drive the planned UI widgets.

Plus the GF scraper hardcodes 14×13 = 182 pairs (only 12.6% of which overlap with FR24 coverage), most of which are not aligned with FlightFinder's search-traffic patterns. Top observed_routes pairs are Asia-heavy from ADS-B coverage bias — useless for a Western-audience SEO site.

This spec covers the data layer only: get a reliable `route_aircraft_prices` table populated daily, ready for Spec B's UI widgets.

## Decisions

- **Pair list:** replace hardcoded 14×13 with a curated ~200-pair list optimized for Western SEO + aircraft variety. Stored in external config file (`/home/a1/aircrash/pairs.txt`) so updates don't require Go rebuild.
- **Aggregation gate:** `n_quotes >= 3` per (route, aircraft). Below threshold the row isn't written (UI shows nothing rather than misleading single-quote medians).
- **Marketing carrier:** parse `flights.airline` column, take first marketing-carrier token, resolve to ICAO via a new `openFlightsService.getAirlineByName(name)` (added in this spec — not currently exported). Drop rows where resolution fails.
- **Cron sequencing:** mini-PC 03:30 UTC → aircrash-sync-prod (existing) → hetzner 04:30 UTC fr24GfIngest (existing) → hetzner 05:00 UTC aggregate-gf-prices (new).
- **Storage in same `app.db`:** new tables `route_aircraft_prices` + `route_aircraft_prices_meta`. Server reads same DB (WAL mode handles concurrent reads + writes).
- **No JSON-LD Offer schema** (ToS risk on hosted prices). UI is data-quality-honest: shows `snapshot_at` + sample size.

## Architecture

```
mini-PC (a1@192.168.1.191)
  ├─ aircrash-parser -flights=true (PID 255218, long-lived since 2026-05-12)
  │    reads: /home/a1/aircrash/pairs.txt           ← NEW (was hardcoded)
  │    writes: /home/a1/aircrash/accidents.db:flights
  └─ aircrash-sync-prod.timer (03:30 UTC daily, existing)
       rsync accidents.db → root@origin.himaxym.com:/var/lib/flightfinder/data/

hetzner (himaxym-de1)
  ├─ fr24GfIngest.js cron (04:30 UTC daily, existing)
  │    reads: accidents.db:flights (via ATTACH), fr24 API
  │    writes: app.db:fr24_gf_route_aircraft
  └─ aggregate-gf-prices.js cron (05:00 UTC daily, NEW)
       reads: accidents.db:flights (via ATTACH), app.db:fr24_gf_route_aircraft
       writes: app.db:route_aircraft_prices + route_aircraft_prices_meta

Server runtime (Node pm2 cluster)
  ├─ routePricingService.js (NEW) — reads route_aircraft_prices via better-sqlite3
  ├─ /api/routes/:pair/prices endpoint (NEW)
  └─ /api/aircraft/:icao/prices endpoint (NEW)
```

## Section 1: Pair list refactor

**Files:**
- New: `/home/a1/aircrash/pairs.txt` (one pair per line, format `MAD-LIS`, comments with `#`)
- Modified: aircrash-parser Go source (location: user knows, not in repo; user reports it's at `~/aircrash/cmd/parser/main.go` or similar). Replace hardcoded pair slice with file read.

**Pair list construction (~200 pairs total):**

Categorized targets:
- **Transatlantic widebody (~40):** US east coast ↔ Europe hubs (JFK/BOS/EWR/IAD/ORD/ATL/DFW/MIA ↔ LHR/CDG/FRA/AMS/MAD/FCO/MUC), plus US west ↔ Europe (LAX/SFO/SEA/YYZ/YVR ↔ LHR/CDG/FRA).
- **Transpacific (~30):** LAX/SFO/SEA/ORD/JFK/DFW/ATL ↔ NRT/HND/ICN/HKG/PVG/PEK/SIN/SYD/AKL.
- **Europe ↔ Asia long-haul (~30):** LHR/CDG/FRA/AMS/MUC/ZRH/IST ↔ NRT/HND/HKG/SIN/PEK/PVG/BKK/DEL/BOM.
- **Europe ↔ Middle East (~15):** LHR/CDG/FRA/AMS/MUC/MAD ↔ DXB/DOH/IST/TLV.
- **Europe intra (~50):** LHR/CDG/FRA/AMS/MUC/ZRH/VIE/DUB/ARN ↔ MAD/FCO/MXP/BCN/LIS/DUB/PRG/WAW/HEL/OSL/CPH/ATH, plus pair-wise hubs (LHR-CDG, CDG-AMS, FRA-MUC, etc.). Includes MAD-LIS for short-haul Boeing/Airbus comparison value.
- **Asia intra gateway (~15):** NRT/HND ↔ HKG/SIN/BKK/PEK/PVG/ICN; HKG ↔ SIN/BKK/PVG.
- **US domestic (~15):** JFK/LAX/ORD/ATL/DFW/MIA ↔ JFK/LAX/SFO/SEA/LAS/BOS/MIA (narrow-body fleet variation surface).
- **Oceania (~5):** SYD-MEL, SYD-AKL, SYD-LAX, SYD-LHR, SYD-SIN.

The exact list is generated as part of implementation (Task 1 of plan). Each line `DEP-ARR` uppercase IATA. Reverse pairs (`LHR-JFK` and `JFK-LHR`) are both included since one-way fares differ.

**Go parser change (one function):**

```go
// readPairsFromFile returns a list of pairs from path. Each non-empty,
// non-comment line is "DEP-ARR". On any read error or empty file, returns the
// hardcoded fallback so the scraper keeps running.
func readPairsFromFile(path string) [][2]string {
  body, err := os.ReadFile(path)
  if err != nil {
    log.Printf("WARN pair file %s unreadable (%v); using hardcoded fallback", path, err)
    return hardcodedPairs
  }
  var out [][2]string
  for _, line := range strings.Split(string(body), "\n") {
    line = strings.TrimSpace(line)
    if line == "" || strings.HasPrefix(line, "#") { continue }
    parts := strings.Split(line, "-")
    if len(parts) != 2 || len(parts[0]) != 3 || len(parts[1]) != 3 {
      log.Printf("WARN bad pair line: %q; skipping", line)
      continue
    }
    out = append(out, [2]string{strings.ToUpper(parts[0]), strings.ToUpper(parts[1])})
  }
  if len(out) == 0 {
    log.Printf("WARN pair file empty; using hardcoded fallback")
    return hardcodedPairs
  }
  return out
}
```

Read happens at the top of each cycle (not at process start) so an edit-then-`echo` reload doesn't need a restart. The scraper's main loop already sleeps 1h between cycles — file re-read at top of next cycle costs nothing.

**Backup:** `/home/a1/aircrash/pairs.txt` is included in the daily mini-PC → hetzner backup (`flightfinder-backup-pull.timer` we shipped 2026-05-19, `[[reference_minipc-flightfinder-backup]]`) — survives mini-PC disk failure.

**Migration day:** drop new `pairs.txt`, restart aircrash-parser once to pick up the file-read change (this is the only restart needed). Old `flights` rows from 14×13 list remain in DB — they're still valid price data for any overlapping pairs.

## Section 2: aggregate-gf-prices.js

**File:** `server/scripts/aggregate-gf-prices.js`
**Cron:** `0 5 * * *` (05:00 UTC daily, after fr24GfIngest at 04:30).
**Lock file:** `/tmp/aggregate-gf-prices.lock` (stale-PID handling, same pattern as fr24GfIngest.js).
**Log:** `/var/log/flightfinder/aggregate-gf-prices.log` (append).

**Schema (new tables in app.db):**

```sql
CREATE TABLE route_aircraft_prices (
  dep_iata      TEXT NOT NULL,
  arr_iata      TEXT NOT NULL,
  aircraft_icao TEXT NOT NULL,
  median_eur    REAL NOT NULL,
  min_eur       REAL NOT NULL,
  max_eur       REAL NOT NULL,
  n_quotes      INTEGER NOT NULL,
  airlines_csv  TEXT NOT NULL,
  snapshot_at   INTEGER NOT NULL,
  PRIMARY KEY (dep_iata, arr_iata, aircraft_icao)
);
CREATE INDEX idx_rap_pair     ON route_aircraft_prices(dep_iata, arr_iata);
CREATE INDEX idx_rap_aircraft ON route_aircraft_prices(aircraft_icao);

CREATE TABLE route_aircraft_prices_meta (
  run_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  pairs_processed  INTEGER,
  buckets_in       INTEGER,
  buckets_out      INTEGER,
  quotes_total     INTEGER,
  skipped_thin     INTEGER,
  skipped_no_match INTEGER,
  status           TEXT
);
```

**Algorithm:**

```js
// 1. Open app.db RW, ATTACH accidents.db RO via 'accidents'
// 2. Begin transaction. Insert meta row with started_at = now, status='running'.
// 3. Read all distinct (dep, arr) pairs from fr24_gf_route_aircraft (this is the
//    universe — only pairs FR24 has bucket data for can have priced output).
// 4. For each (dep, arr):
//    a. Pull all GF quotes:
//       SELECT rowid, price, airline FROM accidents.flights
//       WHERE origin=? AND destination=? AND (stops IS NULL OR stops='' OR stops='Nonstop')
//    b. Parse price '€296' → 296. Skip non-EUR or unparseable.
//    c. Parse airline → first marketing carrier token (e.g. 'British AirwaysIberia'
//       → split on capital-letter boundary, take 'British Airways').
//       Resolve to ICAO via openFlightsService.getAirlineByName(name).
//       Skip if no match.
//    d. Pull FR24 buckets for this pair:
//       SELECT aircraft_icao, airline_icao, sample_size
//       FROM fr24_gf_route_aircraft WHERE dep_iata=? AND arr_iata=?
//    e. Group quotes by airline_icao. For each (aircraft_icao, airline_icao)
//       bucket, intersect with quotes matching the airline_icao. The aircraft
//       attribution is by-airline (we don't know which aircraft a specific quote
//       flew on, so we attribute proportionally to buckets the airline operates
//       on this pair — see "blur expansion" below).
//    f. For each aircraft_icao on this pair:
//       - Sum quotes from all (aircraft, airline) buckets attributed
//       - DISTINCT rowid for n_quotes (blur dedup)
//       - If n_quotes < 3, skip and increment skipped_thin
//       - Compute median, min, max EUR
//       - airlines_csv = sorted ICAOs that operate this (pair, aircraft) per FR24
// 5. UPSERT all (dep, arr, aircraft_icao) rows into route_aircraft_prices.
//    snapshot_at = now (epoch ms).
// 6. Commit. Update meta row with ended_at, counters, status='ok'.
// 7. Release lock.
```

**Blur expansion (n_quotes calculation):**

For pair LHR-JFK with quotes from `BA`:
- FR24 buckets for (LHR, JFK, BA): `[(B789, 5), (A380, 3)]`
- Total bucket sample: 8
- BA quotes from GF: 12 rowids
- Each rowid contributes to BOTH B789 and A380 (blur — we don't know which it actually flew)
- For B789 row: n_quotes = COUNT(DISTINCT rowid that originate from BA on LHR-JFK) = 12
- For A380 row: same n_quotes = 12
- Median/min/max are computed across the SAME 12 quotes for both aircraft rows (because we can't disambiguate). Both rows will show identical price stats.

This is a known limitation — the data is "fares typical on the route", not "fares typical on this specific aircraft type". The UI copy says "Typical fares by aircraft on this route" not "Typical fares for this aircraft" — matches the actual semantic.

If a more granular breakdown is wanted later, would need actual flight-number-level data (not available from GF scrape).

### Section 2.1: New helper `openFlightsService.getAirlineByName`

OpenFlights' airlines.dat has a `name` field. Today the service exposes lookups by IATA and ICAO only. Add a name-keyed lookup:

```js
// At module init, augment the existing airline-map build loop:
const airlinesNameMap = new Map(); // normalized-name → airline record
for (const a of airlines) {
  if (a.name) airlinesNameMap.set(normalizeName(a.name), a);
}

function normalizeName(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, ' ')   // strip punctuation/diacritics
    .trim();
}

exports.getAirlineByName = (name) => {
  if (!name) return null;
  return airlinesNameMap.get(normalizeName(name)) || null;
};
```

Tests: `'British Airways'` → BA/BAW record. `'british-airways'` → same (punctuation-tolerant). `'NonExistent'` → null. No regression on existing exports.

**Error handling:**
- Any DB error: rollback, write meta row with status='error', re-raise (exit 1).
- Lock contention: log SKIP, exit 0 (not an error).
- airline name → ICAO miss: count to skipped_no_match, continue.
- No quotes for a pair: skip, no row written. Pair simply absent from output.

**Testing:**
- Unit tests against in-memory SQLite fixtures (3 pairs, ~30 quotes, ~5 buckets).
- One test for blur expansion correctness.
- One test for n_quotes < 3 filter (single-quote pair → no row in output).
- One test for malformed price/airline → skipped, doesn't break run.
- Integration test: full run against real prod data (CLI flag `--dry-run` writes meta but no UPSERTs, prints summary stats).

## Section 3: routePricingService + endpoints

**File:** `server/src/services/routePricingService.js`

```js
const { db } = require('../models/db');
const cacheService = require('./cacheService');
const openFlights = require('./openFlightsService');
const aircraftSafetyService = require('./aircraftSafetyService');
const safetyRating = require('./safetyRating');
const { getFamilyByCode, slugify: aircraftSlug } = require('../models/aircraftFamilies');

// 5-year safety summary helper — built inline using existing aircraftSafetyService.
// Returns { accident_count_5y, level: 'green'|'yellow'|'red' }.
function safetySummaryForIcao(icao) {
  const fam = getFamilyByCode(icao);
  if (!fam) return { accident_count_5y: 0, level: 'green' };
  const cutoffMs = Date.now() - 5 * 365 * 24 * 3600 * 1000;
  const events = aircraftSafetyService.getMergedEventsForFamily(fam);
  const recent = events.filter(e => (e.date_ms || 0) >= cutoffMs);
  const n = recent.length;
  const level = n === 0 ? 'green' : (n <= 3 ? 'yellow' : 'red');
  return { accident_count_5y: n, level };
}

const CACHE_TTL_S = 5 * 60;

exports.getPricesForRoute = function getPricesForRoute(dep, arr) {
  const depU = String(dep).toUpperCase();
  const arrU = String(arr).toUpperCase();
  const key = `rap:route:${depU}:${arrU}`;
  const cached = cacheService.get(key);
  if (cached !== undefined) return cached;

  const rows = db.prepare(`
    SELECT aircraft_icao, median_eur, min_eur, max_eur, n_quotes, airlines_csv, snapshot_at
    FROM route_aircraft_prices
    WHERE dep_iata = ? AND arr_iata = ?
    ORDER BY median_eur ASC
  `).all(depU, arrU);

  const enriched = rows.map(r => {
    const fam = getFamilyByCode(r.aircraft_icao);
    const airlines = r.airlines_csv ? r.airlines_csv.split(',') : [];
    return {
      aircraft_icao: r.aircraft_icao,
      aircraft_name: fam?.label || r.aircraft_icao,
      aircraft_slug: fam ? aircraftSlug(fam.label) : r.aircraft_icao.toLowerCase(),
      median_eur: r.median_eur,
      min_eur: r.min_eur,
      max_eur: r.max_eur,
      n_quotes: r.n_quotes,
      airlines,
      airlines_display: airlines.map(icao => openFlights.getAirlineByIcao(icao)?.name || icao).join(', '),
      safety: safetySummaryForIcao(r.aircraft_icao), // { accident_count_5y, level }
      snapshot_at: r.snapshot_at,
    };
  });

  cacheService.set(key, enriched, CACHE_TTL_S);
  return enriched;
};

exports.getRoutesForAircraft = function getRoutesForAircraft(icao, limit = 10) {
  const icaoU = String(icao).toUpperCase();
  const key = `rap:aircraft:${icaoU}:${limit}`;
  const cached = cacheService.get(key);
  if (cached !== undefined) return cached;

  const rows = db.prepare(`
    SELECT dep_iata, arr_iata, median_eur, min_eur, max_eur, n_quotes
    FROM route_aircraft_prices
    WHERE aircraft_icao = ?
    ORDER BY n_quotes DESC
    LIMIT ?
  `).all(icaoU, limit);

  const enriched = rows.map(r => {
    const depAp = openFlights.getAirport(r.dep_iata);
    const arrAp = openFlights.getAirport(r.arr_iata);
    return {
      dep_iata: r.dep_iata,
      arr_iata: r.arr_iata,
      dep_city: depAp?.city || r.dep_iata,
      arr_city: arrAp?.city || r.arr_iata,
      median_eur: r.median_eur,
      min_eur: r.min_eur,
      max_eur: r.max_eur,
      n_quotes: r.n_quotes,
    };
  });

  cacheService.set(key, enriched, CACHE_TTL_S);
  return enriched;
};
```

**Endpoints:**

`server/src/routes/routePricing.js`:
```js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/routePricingController');

router.get('/:pair/prices', ctrl.getRoutePrices);

module.exports = router;
```

Mount in `server/src/index.js` next to existing `/api/routes` mount:
```js
app.use('/api/routes', require('./routes/routePricing'));
```

`server/src/routes/aircraft.js` (existing) — add:
```js
router.get('/:icao/prices', require('../controllers/aircraftPricesController').get);
```

**Controllers:** parse `:pair` as `dep-arr` lowercase (existing convention from `/api/routes/:pair`), validate IATA 3-letter, call service. Return 404 if empty result (no data for this route/aircraft yet). Return 200 with array otherwise. `Cache-Control: public, max-age=300`.

**Tests:**
- Service unit tests with in-memory app.db fixtures.
- Routes integration tests via supertest: 400 invalid IATA, 404 unknown pair, 200 with mocked service data, Cache-Control header present.

## Risks and mitigations

1. **Blur expansion creates duplicate stats across aircraft on same pair.** Mitigated by UI copy ("typical fares by aircraft ON THIS ROUTE", not "for this aircraft") and explicit `n_quotes` display. Spec B may add a notice when stats are identical across rows.
2. **airline name → ICAO resolution fails on multi-carrier strings.** `'British AirwaysIberia'` — parser takes 'British Airways'. Edge cases: `'JetBlueDelta'`, `'Air FranceKLM'`. Parser splits on capital-letter boundaries; documented in code.
3. **`fr24_gf_route_aircraft` last_seen_at staleness.** FR24 ingest TTL is 7 days. A pair scraped today but not in FR24 last 7d → no aircraft buckets → no priced output. Mitigation: aggregate-gf-prices ignores stale buckets (filter `last_seen_at > now - 30d`).
4. **`route_aircraft_prices` could grow large.** 200 pairs × avg 4 aircraft = ~800 rows. Negligible.
5. **`pairs.txt` typo on mini-PC.** Single bad line skipped with warning. Empty/missing file → hardcoded fallback. Cannot break the scraper.
6. **Cron drift.** If fr24GfIngest runs late (network issues), aggregate-gf-prices at 05:00 sees stale `fr24_gf_route_aircraft`. Acceptable — falls forward, next day cycle catches up.
7. **Aircraft family resolution.** `getFamilyByCode(icao)` may return null for less common ICAO types (e.g. `B752` variant). Fallback: display raw ICAO string. Acceptable — UI still functional.

## Out of scope (Spec B territory)

- UI components (RouteAircraftPrices.jsx, AircraftTopRoutesPrices.jsx) — Section 4 of brainstorm
- SSR bake in seoContentBuilders — Section 6 of brainstorm
- Safety badge component — Section 4 detail
- Deep-link to Google Flights — Section 4 detail
- IndexNow ping for newly-baked content — deploy concern, in Spec B
- Mobile collapse CSS — UI concern, in Spec B

## Files affected (Spec A)

**New:**
- `/home/a1/aircrash/pairs.txt` (mini-PC; outside FF repo)
- `server/scripts/aggregate-gf-prices.js`
- `server/src/__tests__/aggregateGfPrices.test.js`
- `server/src/services/routePricingService.js`
- `server/src/__tests__/routePricingService.test.js`
- `server/src/routes/routePricing.js`
- `server/src/controllers/routePricingController.js`
- `server/src/controllers/aircraftPricesController.js`
- `server/src/__tests__/routePricing.routes.test.js`

**Modified:**
- aircrash-parser Go source (user's local repo) — replace hardcoded pair slice with `readPairsFromFile`
- `server/src/index.js` — mount `/api/routes` routePricing router
- `server/src/routes/aircraft.js` — add `/:icao/prices`
- `server/src/models/db.js` — schema migrations for `route_aircraft_prices` + meta table

**Deploy:**
- Crontab line on hetzner: `0 5 * * * cd /root/flightfinder && /usr/bin/node server/scripts/aggregate-gf-prices.js >> /var/log/flightfinder/aggregate-gf-prices.log 2>&1`

## Success criteria

After deploy + 7 days of cron runs:
- `route_aircraft_prices` has ≥ 50 rows
- ≥ 10 distinct (dep, arr) pairs covered
- Median `n_quotes` per row ≥ 5
- Daily cron green, zero `status='error'` in meta
- `GET /api/routes/lhr-jfk/prices` returns ≥ 1 row in JSON
- `GET /api/aircraft/b789/prices` returns ≥ 1 row in JSON
- Mini-PC pair-file editable (drop new line → next cycle scrapes it)

If success → proceed to Spec B (UI + SEO).

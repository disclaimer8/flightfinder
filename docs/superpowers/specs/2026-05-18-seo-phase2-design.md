# SEO Phase 2 — Design

**Status:** Draft 2026-05-18
**Prerequisites:** Phase 1 shipped 2026-05-17 (`docs/superpowers/plans/2026-05-17-airport-route-seo-phase1.md`)
**Strategy parent:** `docs/superpowers/specs/2026-05-17-airport-route-seo-strategy.md`
**Memory:** `[[project_flightfinder-seo-phase1]]`, `[[project_flightfinder-seo-phase2]]`

## Goal

Convert the Phase 1 backlog (technical debt + manual validation + new URL families) into a sequenced, risk-first execution plan that:

1. Validates Phase 1 schema parses and reaches Search Console (no point adding URLs if existing ones are silently broken).
2. Fixes hygiene that compounds with every future change (deploy reload, missing index, redundant Amadeus path).
3. Expands the URL surface in priority order — small/safe (alliances) before bigger/riskier (countries) before blocked (aircraft × airport, freshness badges).
4. Defers Search Console-driven iteration until 4-8 weeks of impression data exists.

## Non-goals

- Aircraft × airport pages (C1) — blocked on FlightConnections crawler Phase D; reactivate when FC data is ingested.
- Cross-source freshness badge (C4) — needs FC data for full picture; deferred to Wave 4.
- PAA / query iteration (C5) — requires Search Console signal that doesn't exist yet.
- `FF_SEO_P1_STAGE=all` flip — current `top50` stage stays; revisit B5 cap when that flip is planned.
- Any new builder pattern; all P2 builders follow the inner-HTML contract established in Phase 1 (`fa3a3d1`).

## Approach: risk-first sequencing

Five waves. Wave 2 has a branch decided by a SQL query in Wave 1.

```
Wave 0 (manual, today, ~1h)
  └── A.1 RRT 6 URL  +  A.2 sitemap submit  +  A.3 baseline impressions
       │
       ▼
Wave 1 (hygiene, 2-4h)
  ├── B7 deploy webhook fix
  ├── B3 route_carriers(carrier_iata) index
  └── B2 coverage SQL  ───►  result drives Wave 2 fork
       │
       ▼
Wave 2 (architecture, depends on B2)
  ├── ≥95% coverage: retire bAirline (kills B1 + coexistence try/catch)
  └── <95% coverage: patch B1 (jonty-aware title in airlineMeta) + defer B2
       │
       ▼
Wave 3 (surface, ~1 week)
  ├── C3 alliance pages (3 URL, hand-curated)
  ├── C2 country pages (~250 URL, jonty-aggregated)
  └── B4 routeSlug helper extraction (opportunistic)
       │
       ▼
Wave 4 (deferred — trigger: FC Phase D done)
  ├── C1 aircraft × airport
  ├── C4 cross-source freshness badge
  └── B5 enumerate cap revisit
       │
       ▼
Wave 5 (data-driven — trigger: 4-8 weeks Search Console signal)
  └── C5 PAA + query-led iteration
```

A.3 (monitoring) runs in parallel with Waves 1-3 — Search Console signal lags weeks behind, so it never gates downstream work.

---

## Wave 0 — Manual validation

**Effort:** ~1h, no code.

### A.1 Rich Results Test for 6 Phase 1 URLs

For each URL below, paste into <https://search.google.com/test/rich-results> and confirm:

| URL | Expected schema | Trap watchlist |
|---|---|---|
| `https://himaxym.com/about/team` | Person, BreadcrumbList | — |
| `https://himaxym.com/methodology` | Dataset, BreadcrumbList | `license` field present |
| `https://himaxym.com/flights-from/ATL` | Airport + BreadcrumbList + FAQPage | `spatialCoverage` is **Place**, not Country |
| `https://himaxym.com/flights-to/LHR` | Airport + BreadcrumbList + FAQPage | same |
| `https://himaxym.com/airline/EI` | BreadcrumbList + FAQPage (Airline if bAirline coexistence still active) | Vehicle/Product warnings |
| `https://himaxym.com/airline/EI/from/DUB` | BreadcrumbList + FAQPage | same |

Record results in `docs/superpowers/seo-rrt-results-2026-05-18.md` (evidence for future regression comparisons).

### A.2 Submit sitemap

Search Console → himaxym.com property → Sitemaps → submit `https://himaxym.com/sitemap.xml`. Confirm status `Success`.

### A.3 Capture baseline impressions

Search Console → Performance → Pages, filter prefix groups:
- `/flights-from/`
- `/flights-to/`
- `/airline/`

Record today's impressions (expected ~0 for the new families) in the RRT results doc as the comparison baseline for Wave 5.

**Success criteria:**
- 6/6 URLs parse without errors in RRT
- Sitemap submission status = Success
- Baseline impressions captured

---

## Wave 1 — Hygiene

**Effort:** 2-4h. Tasks are independent and can run in parallel.

### B7 — Deploy webhook auto-reload

**Problem:** Phase 1 smoke revealed that pushing to `origin/main` triggers webhook → `git fetch + reset --hard`, but `pm2` does not pick up the new code. Manual `ssh hetzner 'pm2 restart flightfinder'` was required after every Phase 1 deploy.

**Investigation steps:**
1. `ssh hetzner` and locate the webhook handler (likely a small script in `/root/` or a systemd unit).
2. Read the script and identify which of these is true:
   - Script does `pm2 reload` but Node `require()` cache survives reload → builders/services with module-level state stay stale.
   - Script does not have a PATH containing the pm2 binary (nvm install) → command fails silently.
   - Script omits the reload step entirely.
3. Cross-reference with memory `[[deploy-uses-fetch-reset-hard]]` which documents the intended deploy mechanics.

**Fix:** Replace `pm2 reload` (if present) with `pm2 restart flightfinder` in the webhook handler. Hard restart performs full process respawn, eliminates require-cache staleness. Cluster mode means restart is sequential per worker — small (1-2s) but acceptable for low-traffic himaxym. If pm2 not on PATH, prefix `export PATH=/root/.nvm/versions/node/v24.14.0/bin:$PATH`.

**Reject:** graceful-reload pattern (refactor to make all caches reload-safe). Higher risk than benefit at this scale.

**Verification:**
1. Push an empty commit (`git commit --allow-empty -m "test: webhook reload"`).
2. Watch `ssh hetzner 'pm2 list'` — the `restart` counter for `flightfinder` must increment within 60s, with no manual intervention.
3. Hit `https://himaxym.com/some-baked-page` and confirm the response reflects whatever change was in the commit (if any).

### B3 — `route_carriers(carrier_iata)` index

**Problem:** Primary key is `(origin_iata, dest_iata, carrier_iata)`. Queries with `WHERE carrier_iata = ?` do a full scan (no leftmost-prefix match). This affects every lazy bake of `/airline/:iata` and `/airline/:iata/from/:airport`.

**Implementation:**
1. Add to `server/scripts/sync-jonty.js` after the `route_carriers` table is loaded:
   ```js
   db.exec('CREATE INDEX IF NOT EXISTS idx_route_carriers_carrier ON route_carriers(carrier_iata);');
   ```
2. Apply immediately on prod without waiting for the next sync cycle:
   ```
   ssh hetzner 'sqlite3 /var/lib/flightfinder/data/jonty.db "CREATE INDEX IF NOT EXISTS idx_route_carriers_carrier ON route_carriers(carrier_iata);"'
   ```
3. **Mini-PC sync caveat:** Per memory `[[minipc-sync-symlink-trap]]`, the daily 03:30 UTC sync replaces files at `/var/lib/flightfinder/data/`. The next sync after step 1 ships will rebuild `jonty.db` with the index (since sync-jonty.js is the source of truth). Step 2 just shortcuts the wait.

**Verification:**
```
ssh hetzner 'sqlite3 /var/lib/flightfinder/data/jonty.db "EXPLAIN QUERY PLAN SELECT * FROM route_carriers WHERE carrier_iata = '\''LH'\''"'
```
Output should contain `SEARCH route_carriers USING INDEX idx_route_carriers_carrier`, not `SCAN`.

No tests needed — index is behaviorally invisible.

### B2 — Coverage SQL (discovery only)

**Goal:** Single number — % of FF `observed_routes` carriers (after ICAO→IATA mapping) that exist in jonty's `route_carriers`. Drives Wave 2 fork.

**Query** (run on hetzner via `ssh hetzner 'sqlite3 /var/lib/flightfinder/data/app.db'`):

```sql
ATTACH DATABASE '/var/lib/flightfinder/data/jonty.db' AS j;

WITH ff_carriers AS (
  SELECT DISTINCT airline_iata AS icao
  FROM observed_routes
  WHERE airline_iata IS NOT NULL
),
mapped AS (
  SELECT ff.icao, al.iata
  FROM ff_carriers ff
  LEFT JOIN airlines al ON al.icao = ff.icao
)
SELECT
  COUNT(*) AS total_mapped,
  SUM(CASE WHEN EXISTS (
    SELECT 1 FROM j.route_carriers jc WHERE jc.carrier_iata = m.iata
  ) THEN 1 ELSE 0 END) AS jonty_covered,
  ROUND(100.0 * SUM(CASE WHEN EXISTS (
    SELECT 1 FROM j.route_carriers jc WHERE jc.carrier_iata = m.iata
  ) THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct
FROM mapped m
WHERE m.iata IS NOT NULL;
```

Record `pct` in the RRT results doc next to other Wave 0/1 outputs.

**⚠️ ICAO trap:** `observed_routes.airline_iata` stores ICAO codes despite the column name (memory `[[observed-routes-airline-column-icao]]`). The query above handles this via `airlines.icao = ff.icao` mapping. Do not change `m.iata` to `m.icao` thinking it's a bug.

**Success criteria Wave 1:**
- B7: empty-commit push triggers auto-restart; verified via `pm2 list` counter
- B3: EXPLAIN QUERY PLAN shows `SEARCH USING INDEX`
- B2: `pct` number known; Wave 2 fork chosen

---

## Wave 2 — Architecture (forked by B2)

### Path A — Retire bAirline (if B2 coverage ≥93%)

**Threshold rule (single source of truth):**
- ≥93% → Path A (retire bAirline, thin `noindex` stub for absent carriers)
- <93% → Path B (patch B1 only, keep bAirline as fallback)

**Why 93%:** Below 93%, >7% of real carriers would fall through to a thin stub, which risks Search Console flagging the site for thin/low-value content at scale. At ≥93%, residual <7% is small enough that `noindex` stub absorbs them without aggregate quality signal damage. Plus 3 Amadeus self-service endpoints are dead in prod (memory `[[amadeus-self-service-prod-deprecations]]`), so the bAirline path is increasingly degraded anyway.

**Changes:**
1. **Remove `bAirline`** function from `server/src/services/seoContentBuilders.js`.
2. **Remove coexistence try/catch** in `buildAsync()` (~lines 1349-1374). `airlineNetworkBuilder.build(iata)` becomes the single airline path.
3. **Update `airlineMeta()`** in `server/src/services/seoMetaService.js:568` to derive title/h1/description from jonty exclusively:
   - title: `${airline.name} — route network (${routeCount} routes) | FlightFinder`
   - h1: `${airline.name} route network`
   - description: `Explore ${airline.name}'s ${routeCount} routes across ${destCount} destinations. Last updated ${jontyRefreshDate}.`
4. **Thin stub** for carriers absent from jonty: builder returns a small "Information for this carrier is not yet available" + breadcrumb + suggested airlines. Marked `noindex` to avoid thin-content penalty.
5. **Update `enumerateAirlineNetworkUrls()`** to source from `SELECT DISTINCT carrier_iata FROM j.route_carriers` (not `observed_routes` — avoids the ICAO trap entirely).
6. **Update tests**: delete Amadeus mock cases in `server/src/__tests__/seoBuilders.airline.test.js`; keep + extend jonty cases; ensure stub case has a test.
7. **Cleanup**: search for remaining `bAirline` references in cache pre-warm, isLazyPath tests, etc. Remove all.

**Verification:**
- Smoke 5 high-traffic `/airline/{LH,BA,AA,DL,EK}` — title matches h1 matches body content
- Smoke 1 absent carrier (pick one from B2 query that's in observed_routes but not jonty) — returns 200 with stub + `noindex` meta
- Test baseline preserved: 1257/0/6 (some Amadeus tests deleted = lower count; new stub + jonty assertions = roughly net zero or small positive)

### Path B — Patch B1 only (if B2 coverage <95%)

**Changes:**
1. In `airlineMeta()`, detect jonty presence: call `jontyRouteService.getAirlineNetwork(iata)`; if result has `routes.length > 0`, emit jonty-aware title/h1 (same format as Path A point 3).
2. Else fall through to existing `bAirline`-derived meta.
3. `bAirline` stays. Coexistence try/catch stays. B2 retire deferred until coverage improves (e.g. after FC crawler adds carrier matches).

**Verification:** Same smoke 5 URLs; tests unchanged count.

---

## Wave 3 — Surface expansion

**Effort:** ~1 week, sub-divided into C3 (1-2d, low risk) then C2 (3-4d, medium risk).

### C3 — Alliance pages

**URLs (3):**
- `/alliance/star-alliance`
- `/alliance/oneworld`
- `/alliance/skyteam`

**Data source:** New hand-curated file `server/src/data/alliances.json`:
```json
{
  "star-alliance": {
    "name": "Star Alliance",
    "founded": 1997,
    "members": ["LH","UA","AC","SQ","NH","TG","TK","BR","OZ","SK","LX","OS","SN","LO","TP","ET","EW","CA","ZH","SA","CM","MS","AV","JP"],
    "hubs": ["FRA","MUC","ORD","EWR","YYZ","SIN","NRT","BKK","IST"]
  },
  "oneworld": {
    "name": "Oneworld",
    "founded": 1999,
    "members": ["AA","BA","CX","QF","JL","IB","AY","QR","RJ","UL","S7","MH","AT","AS","FJ"],
    "hubs": ["LHR","DFW","HKG","SYD","HND","MAD","HEL","DOH"]
  },
  "skyteam": {
    "name": "SkyTeam",
    "founded": 2000,
    "members": ["DL","AF","KL","KE","KQ","SU","ZM","UX","RO","SV","CI","CZ","MU","VN","VS","ME","GA","AR","AM","AZ"],
    "hubs": ["ATL","CDG","AMS","ICN","SVO","SVQ","TPE","HAN"]
  }
}
```
(Membership lists confirmed at spec-write time; verify on official alliance sites before shipping.)

**Builder:** `server/src/services/allianceBuilder.js`
- `build(slug)` → inner HTML
- Aggregates via loop over members: `getAirlineNetwork(memberIata)` for each, sum total routes, dedupe destinations, top 20 by frequency
- Sections: alliance overview, member list (linking to `/airline/:iata`), aggregated top destinations, FAQ

**Resolver:** New `kind: 'alliance'` in `seoContentBuilders.resolveMeta`; `meta = { kind, slug, title, h1, description, canonical }`.

**Schema (JSON-LD):**
- Organization (the alliance itself)
- ItemList of member airlines
- BreadcrumbList (`Home > Alliances > Star Alliance`)
- FAQPage with 3-5 alliance-specific Q&A

**Sitemap:** `enumerateAllianceUrls()` → 3 URLs hardcoded from JSON keys. No stage filter (micro-set).

**Tests:**
- `seoBuilders.alliance.test.js` — happy path 3 slugs + invalid slug returns null
- Add to `builderEnumeratorCoupling.test.js` (sample 3 alliances)
- Add to `schemaMarkup.test.js` — Organization + ItemList + FAQPage
- Add to `seoContentCache.isLazyPath.test.js` — `/alliance/star-alliance` matches

**Cross-cutting trap checks (mandatory):**
- `[[lazy-bake-regex-sync]]`: `seoContentCache.isLazyPath` regex extended to match `^/alliance/[a-z-]+$`
- `[[seo-builder-shell-contract]]`: builder returns inner HTML only, meta resolver emits full meta
- `[[seo-bake-invariants]]`: builder + enumerator coupling test includes alliance

### C2 — Country pages

**URLs:** `/country/:cc` where `cc` is ISO 3166-1 alpha-2 (`US`, `DE`, `JP`, ...).

**Expected count:** ~200-250 URLs (countries with ≥1 airport in jonty).

**Data source:** Existing `jonty.airports.country_code` column (no schema changes). New SQL helpers in `server/src/services/jontyRouteService.js`:
- `getCountryStats(cc)` returns:
  ```js
  {
    code: 'US',
    name: 'United States',  // resolved from a static ISO code → name map
    airportCount: 4823,
    routeCount: 38291,
    topAirports: [{iata:'ATL',name:'...',routeCount:980}, ...],   // top 10 by COUNT(*) routes
    topAirlines: [{iata:'AA',name:'...',routeCount:8210}, ...],   // top 10 by COUNT(*) routes
    popularRoutes: [{from:'LAX',to:'JFK',carrierCount:7}, ...]    // top 10 internal+outbound
  }
  ```

**Aggregation SQL** (in jontyRouteService):
- Top airports: `SELECT origin_iata, COUNT(*) c FROM route_carriers rc JOIN airports a ON a.iata=rc.origin_iata WHERE a.country_code=? GROUP BY origin_iata ORDER BY c DESC LIMIT 10`
- Top airlines: same shape on `carrier_iata`
- Popular routes: `SELECT origin_iata, dest_iata, COUNT(DISTINCT carrier_iata) c FROM route_carriers rc JOIN airports a ON a.iata=rc.origin_iata WHERE a.country_code=? GROUP BY origin_iata, dest_iata ORDER BY c DESC LIMIT 10`

**Index check (must run EXPLAIN QUERY PLAN before merging):**
- `airports.country_code` — likely no index. Add `CREATE INDEX IF NOT EXISTS idx_airports_country ON airports(country_code);` in `sync-jonty.js`.
- `route_carriers.origin_iata` — PK leftmost, no index needed.
- `route_carriers.carrier_iata` — covered by B3.

**ISO code → name map:** Static `server/src/data/iso-countries.json` (~250 entries). Hand-write or pull from existing library (check `Intl.DisplayNames('en', { type: 'region' }).of('US')` — Node native, no dep).

**Builder:** `server/src/services/countryBuilder.js`
- Sections: country header (name, airport count, route count), top airports list (linking `/flights-from/:iata`), top airlines list (linking `/airline/:iata`), popular routes list (linking `/routes/:from-:to`), FAQ

**Resolver:** New `kind: 'country'`.

**Schema (JSON-LD):**
- **Place** (the country — not `Country` type per `[[seo-schema-validator-traps]]`)
- ItemList × 3 (airports, airlines, routes)
- BreadcrumbList
- FAQPage with country-specific Q&A

**Sitemap:** `enumerateCountryUrls()` → `SELECT DISTINCT country_code FROM jonty.airports WHERE country_code IS NOT NULL`. No stage filter — 250 URLs is small.

**Staging decision:** No `FF_SEO_P2_STAGE` gate for C2. 250 URLs total is mizer relative to the existing top50×2 + airline×airport surface. Ship at full from day one.

**Tests:**
- `seoBuilders.country.test.js` — happy path for 5 countries (US/DE/JP/FR/GB), missing country returns null, country with zero airports returns thin/noindex
- Add to `builderEnumeratorCoupling.test.js`
- Add to `schemaMarkup.test.js` — Place + ItemList + FAQPage
- Add to `seoContentCache.isLazyPath.test.js` — `/country/US` matches

**Cross-cutting trap checks (mandatory):**
- `[[lazy-bake-regex-sync]]`: regex extended for `^/country/[A-Z]{2}$` — **3× trap; do not skip**
- `[[seo-builder-shell-contract]]`: inner HTML only
- `[[seo-bake-invariants]]`: coupling test extended
- `[[seo-schema-validator-traps]]`: Place not Country; verify RRT after deploy

### B4 — `routeSlug` helper extraction (opportunistic)

Inlined in `airportLandingBuilder`, `airlineAirportBuilder`, `airlineNetworkBuilder`. While touching these during C2/C3 (popular routes section reuses the same pattern), extract:

```js
// server/src/services/seoSharedUtil.js
export function routeSlug(origin, dest) {
  return `${origin.toLowerCase()}-${dest.toLowerCase()}`;
}
```

No standalone PR — bundled with the C2 PR.

### Wave 3 success criteria

- 3 `/alliance/*` URLs return 200; RRT clean; h1 matches title matches body
- 10 baseline `/country/*` URLs (US/DE/JP/FR/GB/CN/IN/BR/CA/AU) return 200; RRT clean
- Sitemap includes both families; total URL count well under 50K
- Test baseline: 1257 + ~15 new = 1270-1275 passing, 0 failing
- B4 helper used in ≥3 builders, no duplicated slug logic remains

---

## Wave 4 — Deferred (trigger: FC Phase D done)

**Status:** Specs not detailed in P2; resume when FlightConnections crawler Phase D completes (per `[[project_flightconnections-crawler]]` 30-task plan).

### C1 — Aircraft × airport

URL: `/aircraft/:family/from/:iata`. Filters airport departures by aircraft family. Requires FC crawl data (aircraft-on-route).

⚠️ Trap: `[[aircraft-family-name-vs-label]]` — `name` for SQL LIKE, `label` only for UI.

### C4 — Cross-source freshness badge

Frontend addition on `/flights-from/*`, `/airline/*`, `/country/*`: small badge `last seen YYYY-MM-DD` per source (FF observed 90d / jonty weekly / FC crawl date). Trust + EEAT signal; no direct SEO impact.

### B5 — Enumerate cap revisit

Hard 30K cap in `enumerateAirlineAirportUrls()` only matters at `FF_SEO_P1_STAGE=all`. When that flip is planned, add either smart cap (top-N destinations per carrier) or pagination (sitemap index pattern).

---

## Wave 5 — Data-driven iteration (trigger: 4-8 weeks Search Console signal)

### C5 — PAA attack + query iteration

Sources: Search Console Performance API. Weekly automated dump → analysis.

**Iteration types:**
- High impressions / low CTR → rewrite title + description
- Position 4-15 / good query → expand FAQ section to target the snippet specifically
- Impressions but no content match → expand page depth
- Off-target queries → noindex or rewrite

Multiple sprints; explicitly out of P2 implementation scope. Spec will be authored once data exists.

---

## Cross-cutting traps — checklist per new URL family

Every new URL family in P2 (alliance, country, and any future) must pass these 5 checks before merging. Reviewer should verify each:

| Trap (memory) | Concrete check | File(s) |
|---|---|---|
| `[[lazy-bake-regex-sync]]` | `isLazyPath()` regex matches the new path + test case asserts it | `seoContentCache.js`, `seoContentCache.isLazyPath.*.test.js` |
| `[[seo-bake-invariants]]` | New `kind` is sampled in builder ↔ enumerator coupling test | `builderEnumeratorCoupling.test.js` |
| `[[seo-schema-validator-traps]]` | RRT prod-smoke after deploy; Place (not Country), Dataset.license, no Vehicle/Product warnings | post-deploy smoke |
| `[[seo-builder-shell-contract]]` | Builder returns inner HTML only; meta resolver emits full `{title, h1, description, canonical}` | new builder + resolver |
| `[[observed-routes-airline-column-icao]]` | If reading airline_iata from observed_routes, ICAO→IATA mapping in place; else source from jonty.route_carriers (IATA) | aggregation SQL |

---

## Risks

| Risk | Mitigation |
|---|---|
| B7 deploy fix doesn't catch all reload scenarios | `pm2 restart` is the nuclear option; if specific edge case found (e.g. cron firing during restart), document and patch incrementally |
| B2 coverage hovers at threshold edge | Threshold rule in Wave 2 is binary at 93%. If coverage lands within ±1% (92-94%), pause and confirm path with user before executing Wave 2 (gut-check whether stub or fallback is right for the specific carriers missing) |
| C2 country aggregation slow on first-hit lazy bake | If p95 first-bake >2s, add `idx_airports_country` (already speced) + cache aggregation result in jonty.db materialized table |
| Sitemap exceeds 50K URLs limit when C2 + C3 + future families compound | Switch to sitemap index format (already supported by Search Console) before hitting 40K |
| `/airline/EI` smoke fails after bAirline retire because of cache pre-warm caching old paths | After Wave 2 Path A deploy, manually invalidate prewarm cache: `ssh hetzner 'rm /var/lib/flightfinder/data/seo-cache/*airline*'` or equivalent |
| Wave 0 RRT reveals broken schema in Phase 1 | Stop forward progress; emergency fix; re-run RRT before resuming Wave 1 |

---

## Open questions

None blocking. Tracking items that may surface during execution:

1. After B2 result, if coverage is in 92-94% gray zone, confirm Wave 2 path with user before executing (per Risks).
2. C2 country name source: native `Intl.DisplayNames` vs hand-curated JSON. Default native; switch to JSON if i18n inconsistencies surface.
3. Alliance JSON membership lists are time-sensitive (carriers join/leave). Add a comment with "last verified YYYY-MM-DD" and consider quarterly verification reminder.

---

## Success criteria (overall Phase 2)

By end of Wave 3:
- 100% of Phase 1 schema parses validated in RRT (Wave 0)
- Zero manual `pm2 restart` required after `git push` (B7)
- Every `/airline/*` lazy bake faster than pre-B3 (route_carriers index)
- `/airline/:iata` title + h1 + body content consistent (B1 patched or eliminated)
- 253-258 new indexable URLs live (~3 alliance + ~250 country)
- Test baseline: 1270-1275 passing, 0 failing
- Sitemap submitted, baseline impressions captured for Wave 5 comparison

By end of Wave 4 (post-FC):
- Aircraft × airport family live; freshness badges shipped; airline × airport stage can flip to `all` safely

By end of Wave 5:
- Search Console-driven content iteration loop running; CTR + position improvements documented per family

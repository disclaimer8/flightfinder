# Airport & Route SEO Phase 1 — Progress Log

**Spec:** `docs/superpowers/specs/2026-05-17-airport-route-seo-strategy.md`
**Plan:** `docs/superpowers/plans/2026-05-17-airport-route-seo-phase1.md`
**Branch:** `main`
**Implementation period:** 2026-05-17 (Tasks 7-17 in a single session via subagent-driven-development)
**Deploy date:** _pending Task 18_

---

## What shipped

23 commits between `a1640ff` (Task 1 — `/about/team`) and `1487150` (Task 17 — staged rollout). All landed on `main`, not yet pushed.

### URL families now lazy-bakeable + sitemap-advertised

| Family | URL pattern | Kind | Builder | Stage default |
|---|---|---|---|---|
| Author entity | `/about/team` | `entity` | `aboutTeamPage.js` | always |
| Methodology | `/methodology` | `entity` | `methodologyPage.js` | always |
| Airport departures | `/flights-from/:iata` | `airport-departures` | `airportLandingBuilder.buildDepartures` | top-50 hubs |
| Airport arrivals | `/flights-to/:iata` | `airport-arrivals` | `airportLandingBuilder.buildArrivals` | top-50 hubs |
| Airline network (coexistence) | `/airline/:iata` | `airline` | jonty-or-`bAirline` (see below) | all carriers in jonty |
| Airline × airport | `/airline/:iata/from/:airport-iata` | `airline-airport` | `airlineAirportBuilder.build` | top-50 hub origins |
| Route detail (enriched) | `/routes/:from-:to` | `route` | `bRoute` + `_renderJontyEnrichment` | all (existing family) |

### Coexistence strategy — `/airline/:iata`

The plan originally proposed replacing the existing `bAirline` builder (Amadeus + observed_routes, commit `b980772`) with a new jonty-only builder. Diverged at Task 11 after surfacing the conflict — pre-existing `kind: 'airline'` had 10+ test files and live prod traffic.

Adopted strategy: keep `kind: 'airline'` resolver. In `buildAsync`, when `meta.kind === 'airline'`, check `route_carriers WHERE carrier_iata = ?` in jonty.db:
- jonty has data → render `airlineNetworkBuilder` (full HTML, bypass `applyChromeAsync`)
- jonty empty / error → fall through to existing `bAirline + applyChromeAsync`

This preserves all 27 existing `seoBuilders.airline*` tests while enabling the jonty path for any carrier with route data.

Old `bAirline` to be retired in Phase 2 once jonty coverage reaches ~95% of FF's `observed_routes` carriers.

---

## Anti-trap test surface

The plan called out three recurring traps (FF memory). Each now has a dedicated guard:

| Trap | Memory | Guard |
|---|---|---|
| Lazy-bake regex desync | `lazy-bake-regex-sync` (hit 3×) | `seoContentCache.isLazyPath.airport.test.js` — 14 cases (6 accepted, 7 rejected, 1 regression guard for existing 5 families) |
| Builder ↔ enumerator coupling | `seo-bake-invariants` | `builderEnumeratorCoupling.test.js` — samples 5 URLs per family, asserts resolve → build → >200 chars HTML |
| Schema validator (Vehicle/Country/Offer) | `seo-schema-validator-traps` | `schemaMarkup.test.js` (Task 4 — already shipped) + manual Rich Results check pending in Task 18 |
| `observed_routes.airline_iata` is ICAO | `observed-routes-airline-column-icao` (hit 2×) | All Phase 1 builders read jonty `route_carriers` (IATA) — never cross-read FF's `observed_routes` |

---

## Test suite delta (relative to `a0fda8b` baseline)

```
baseline    a0fda8b:  1187 passed, 6 failed, 3 skipped  (1196 total)
Phase 1 head 1487150:  1254 passed, 6 failed, 3 skipped  (1263 total)
                       ─────       ──
                       +67 new      ±0 regressions
```

Six pre-existing failures (route FR24 wiring, FAQPage suppression, SPA fallback FR24) are unrelated to Phase 1 and predate Task 7. Verified by running baseline checkout in a temporary worktree.

---

## File inventory

### New service files
```
server/src/services/
├── aboutTeamPage.js              (Task 1)
├── methodologyPage.js            (Task 2)
├── jontyRouteService.js          (Task 3)
├── schemaMarkup.js               (Task 4)
├── seoEditorialIntro.js          (Task 5)
├── seoAircraftPlaceholder.js     (Task 6)
├── airportLandingBuilder.js      (Task 7)
├── airlineNetworkBuilder.js      (Task 8)
├── airlineAirportBuilder.js      (Task 9)
├── seoSharedUtil.js              (post-Task 8, extracted SITE + escapeHtml)
└── seoP1Stage.js                 (Task 17)
```

### Existing files modified
```
server/src/services/
├── seoContentBuilders.js         (Task 10 _renderJontyEnrichment, Task 12 dispatch + coexistence)
├── seoMetaService.js             (Task 11 3 new resolvers)
├── seoContentCache.js            (Task 13 isLazyPath + kind allowlist)
├── seoUrlEnumerator.js           (Task 14 3 enumerators, Task 17 stage filter)
└── routes/seo.js                 (Task 16 sitemap inclusion + dedupe)
```

### Test files added (15)
```
server/src/__tests__/
├── aboutTeamPage.test.js
├── methodologyPage.test.js
├── jontyRouteService.test.js
├── schemaMarkup.test.js
├── seoEditorialIntro.test.js
├── airportLandingBuilder.test.js
├── airlineNetworkBuilder.test.js
├── airlineAirportBuilder.test.js
├── routeDetailBuilder.jontyEnrich.test.js
├── seoMetaService.airport.test.js
├── seoContentBuilders.phase1Dispatch.test.js
├── seoContentCache.isLazyPath.airport.test.js
├── seoUrlEnumerator.airportLanding.test.js
├── builderEnumeratorCoupling.test.js
├── sitemap.airportLanding.test.js
├── seoP1Stage.test.js
└── seoSharedUtil.test.js
```

---

## Staged rollout (top-50 hubs)

Default `FF_SEO_P1_STAGE='top50'` limits `enumerateAirportLandingUrls()` and `enumerateAirlineAirportUrls()` to airports in the curated TOP_50_HUBS list. Switch to `FF_SEO_P1_STAGE='all'` in env + pm2 reload to enable full rollout (Week 4+).

**TOP_50_HUBS** (2025 passenger volume, hand-curated to stabilize Google's perception of "top pages"):
```
ATL, PEK, DXB, LAX, HND, ORD, LHR, CDG, DFW, PVG,
AMS, FRA, HKG, DEN, CAN, ICN, BKK, SIN, SFO, JFK,
LGW, MAD, SEA, MIA, MEL, SYD, MUC, PHX, IAH, BCN,
LAS, MCO, EWR, CLT, FCO, IST, BOM, DEL, SVO, SHA,
NRT, KMG, SZX, CTU, HAN, SGN, MNL, CGK, KUL, DOH
```

Source: `server/src/services/seoP1Stage.js` — keep this section in sync if the list edits.

### Sitemap volume estimates

With `top50` (default):
- airport landings: 50 × 2 = ~100 URLs
- airline networks: ~600 (full — carriers not stage-filtered)
- airline×airport: ~hundreds (only carriers with top-50 origin)
- **Total Phase 1 increment: ~700-1000 URLs**

With `all`:
- airport landings: 3.9K × 2 = ~7.8K
- airline networks: ~600
- airline×airport: capped at 30K (raw count ~58K)
- **Total Phase 1 increment: ~38K URLs**

---

## Open follow-ups

### Pending Task 18 (production deploy + smoke)
1. `git push origin main` (23 commits ahead)
2. Wait for deploy CI to complete
3. curl smoke test 6 URLs (codes per family expected 200)
4. View-source check — verify baked HTML, not React shell
5. Google Rich Results Test for Airport / BreadcrumbList / FAQPage / Dataset / Person
6. Submit sitemap to Search Console

### Plan deferred to subsequent phases
- Aircraft type column in P2 (needs FlightConnections crawl data)
- `/aircraft/:family/from/:iata` family (P2)
- Country + alliance families (P3)
- Cross-source freshness badge
- Featured-snippet attack on PAA winners (post-launch)

### Technical debt from this Phase
- `route_carriers(carrier_iata)` lacks index (full-scan on every `getAirlineNetwork()` call) — add `CREATE INDEX idx_route_carriers_carrier ON route_carriers(carrier_iata)` in `server/scripts/sync-jonty.js` next jonty refresh
- `routeSlug(origin, dest)` helper deferred — currently inlined in 3+ places across Phase 1 builders
- `enumerateAirlineAirportUrls` capped at 30K — fine with `top50`, would need re-cap or pagination at `all`
- Old `bAirline` (Amadeus path) to retire in Phase 2 when jonty coverage is verified ≥95%

---

## Memory updates needed

After Task 18 smoke completes:
- `project_flightfinder.md` — add Phase 1 SEO shipped (5 page families, top-50 staged)
- `feedback_lazy-bake-regex-sync.md` — note the new test (`seoContentCache.isLazyPath.airport.test.js`) as the loud guard
- Consider adding new memory `feedback_seo-coexistence-pattern.md` documenting the jonty-or-old-builder coexistence pattern for Phase 2 reuse

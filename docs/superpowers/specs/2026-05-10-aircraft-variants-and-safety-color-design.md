# Aircraft Variant Pages + Safety Color Band — Design

**Date:** 2026-05-10
**Author:** brainstorm session (Denys + Claude)
**Status:** Draft → pending user review

## Problem

Two SEO gaps in the aircraft topic cluster:

1. **Granularity ceiling.** Every Boeing 787 query — whether the user typed `boeing 787-9` or `boeing 787-10` — lands on the same `/aircraft/boeing-787` page. Long-tail queries that distinguish variants get no dedicated landing page, and Google has no way to rank us for `boeing 737-800 routes` vs `boeing 737 max 9 safety`.
2. **Safety record is invisible.** We aggregate accident data from NTSB, Aviation Safety Network, B3A and Wikidata, but `/aircraft/{slug}/safety` only displays a count ("12 incidents on file"). Users searching `boeing 737 max crashes` or `airbus a330 safety record` find Wikipedia and aviation forums, not us.

## Goal

Add per-variant aircraft pages and surface the accident record on every aircraft URL with a transparent, fact-only signal — without making numeric safety claims that could be defamatory or methodologically misleading.

## Non-goals

- Numeric safety score (no stars, no letter grades, no 0-100 scale)
- Industry "rate per million departures" — we lack utilisation data
- Comparative ranking between models or families
- New data ingestion (use only the safety_events rows we already have)
- Client-side React changes — this is a pure server-side bake extension
- Any change to existing `/aircraft/{slug}`, `/aircraft/{slug}/{airlines,routes,safety,specs}` URLs (their bake is enriched in place)
- Capacitor mobile build

## Constraints

1. Backwards-compatible: every existing route, response, and DB query continues to work unchanged.
2. Bake layer must continue to degrade gracefully: any failure in safety-rating or variant lookup falls through to today's behaviour, never errors a response.
3. Legal posture: every page that displays the safety color band must carry a visible disclaimer that the color is not a commercial safety rating and does not normalise for utilisation.
4. Variant catalog is hand-curated, not generated. Each ICAO code that we expose as a variant URL must have a verified human-readable name and description.

## Architecture

### URL structure

```
/aircraft/{family-slug}                         family hub (existing, enriched)
/aircraft/{family-slug}/safety                  family safety (existing, enriched)
/aircraft/{family-slug}/airlines                existing
/aircraft/{family-slug}/routes                  existing
/aircraft/{family-slug}/specs                   existing
/aircraft/{family-slug}/variants/{variant-slug} NEW — per-variant SEO leaf
```

Variant slug is derived from a curated mapping in `aircraftVariants.js`:

| ICAO | Variant slug | Family slug |
|------|---|---|
| `B788` | `787-8` | `boeing-787` |
| `B789` | `787-9` | `boeing-787` |
| `B78X` | `787-10` | `boeing-787` |
| `B38M` | `737-max-8` | `boeing-737` |
| `B39M` | `737-max-9` | `boeing-737` |

Estimated variant count: ~50-70 across the 20 families. Sitemap impact: +60-70 URLs.

### Request flow (new variant URL)

```
GET /aircraft/boeing-787/variants/787-9
  └─ spaFallback (server/src/index.js)
       ├─ meta = seoMeta.resolve('/aircraft/boeing-787/variants/787-9')
       │     → { kind: 'aircraft-variant',
       │         variant: {...from aircraftVariants.js},
       │         family:  {...from aircraftFamilies.js},
       │         icaoList: ['B789'],
       │         colorBand: {...from safetyRating.js},
       │         topEvents: [...top 5 fatal hull losses for B789],
       │         allEvents: [...all events for B789, capped 100] }
       ├─ bake = seoContentCache.get(req.path)
       └─ html = seoMeta.inject(indexHtml, meta, bake)
```

### Boot flow

`seoContentCache.warm()` continues to walk `enumerateSeoUrls()` and call
`builders.build()` per path. Both grow:

- `enumerateSeoUrls()` emits new `/aircraft/{family}/variants/{variant}` paths for every entry in `aircraftVariants.js`.
- `builders.build()` adds a new `bAircraftVariant` dispatch and enriches `bAircraft` and `bAircraftSafety` with color band + top-5 + decade-grouped lists.

### New modules

- `server/src/models/aircraftVariants.js` — hand-curated catalog. Each entry: `{family, icao, iata, fullName, shortName, firstFlight, capacity, range_km, engines, description, slug}`.
- `server/src/services/safetyRating.js` — pure functions:
  - `colorBand(events)` returns `{bucket, lastFatalDate, label}` per the bucket table below.
  - `topNotable(events, n)` returns events sorted by `fatalities` DESC then `occurred_at` DESC.
  - `groupByDecade(events)` returns `{ '1980s': [...], '1990s': [...] }`.

### Modified modules

- `server/src/services/seoMetaService.js`
  - New resolver branch for `/aircraft/{family}/variants/{variant}` → `kind: 'aircraft-variant'`.
  - `aircraftMeta` and `aircraftSafetyMeta` enriched with `colorBand`, `topEvents`, `allEvents`, `variants` list (variants only on the family meta).
- `server/src/services/seoContentBuilders.js`
  - New `bAircraftVariant` builder.
  - `bAircraft` extended to render color band, top-5 events, "Variants" list with links.
  - `bAircraftSafety` extended to render color band + decade-grouped full list.
- `server/src/services/seoUrlEnumerator.js` — emit one URL per `aircraftVariants.js` entry.
- `server/src/models/db.js`
  - `getFatalEventsByIcaoList(icaoList)` — `severity IN ('fatal', 'hull_loss') AND fatalities > 0`, ordered by `occurred_at DESC`. Returns full event row.
  - `getAllEventsByIcaoList(icaoList, limit = 100)` — same JOIN, no severity filter, capped.

### Untouched

- Client React, Vite config, Capacitor build.
- Existing builders for non-aircraft kinds (route, pricing, about, map, by-aircraft, home, safety-global, safety-feed).
- Sitemap base structure (variant URLs are added by enumerator).
- robots.txt, OG / Twitter tags, JSON-LD.

## Color band methodology

Five buckets derived from time since the most recent **fatal hull loss** (`severity IN ('fatal', 'hull_loss') AND fatalities > 0`) for the relevant `icaoList`.

| Color | Condition | Label |
|---|---|---|
| Green | No fatal hull losses on record | "No fatal hull losses on record" |
| Light green | >20 years since last fatal hull loss | "No fatal hull losses in 20+ years" |
| Yellow | 5–20 years | "Last fatal hull loss: {YYYY}" |
| Orange | 1–5 years | "Last fatal hull loss: {YYYY}" |
| Red | < 1 year | "Recent fatal hull loss: {YYYY-MM-DD}" |

The same `colorBand()` function runs for both family and variant URLs; the only difference is the `icaoList` argument (one ICAO for variants, all family ICAOs for family pages).

### Mandatory disclaimer

Every page that renders a color band carries this exact text (rendered as a `<p class="safety-disclaimer">` immediately below the band):

> Color reflects time since the last recorded fatal hull-loss involving this type, drawn from public datasets (NTSB, Aviation Safety Network, Bureau of Aircraft Accidents Archives, Wikidata). It is not a commercial safety rating and does not normalise for flights flown, hours, or fleet size — for those, see the manufacturer or IATA Safety Report.

The disclaimer is hard-coded in the builder; removing it requires changing the builder, which forces code review.

## Top-5 + full timeline

### Top-5 (on `/aircraft/{slug}` and `/aircraft/{slug}/variants/{variant}`)

Sort: `fatalities DESC, occurred_at DESC`. Filter: `severity IN ('fatal', 'hull_loss') AND fatalities > 0`. Render as `<ol>`:

```html
<li>
  <time datetime="1985-08-12">1985-08-12</time> —
  <strong>Japan Airlines Flight 123</strong>
  (JA8119, Boeing 747SR-46) — 520 fatalities.
  Tokyo–Osaka. <a href="https://...">Source</a>.
</li>
```

Fields used: `occurred_at` (formatted YYYY-MM-DD), `operator_name`, `narrative` (extracted flight number when present), `registration`, `aircraft_icao_type`, `fatalities`, `dep_iata`/`arr_iata`, `report_url`.

If fewer than 5 qualifying events exist, render however many we have. If 0 events, suppress the section entirely (color band still renders as green).

### Full timeline (on `/aircraft/{slug}/safety` only)

All `severity IN ('fatal', 'hull_loss') AND fatalities > 0` events ordered `occurred_at DESC`, capped at 100. Grouped by decade:

```html
<section>
  <h3>2020s</h3><ul><li>...</li></ul>
  <h3>2010s</h3><ul><li>...</li></ul>
  <h3>2000s</h3><ul><li>...</li></ul>
</section>
```

Variant pages do NOT have a separate `/safety` subpage. The variant's full timeline lives on the variant page itself (after the top-5 section), since per-variant event counts are typically small.

## Variant page content

Each variant URL bakes the following sections in `#root`:

1. **Hero** — H1 = "{shortName} — flights, routes and operators", subtitle = one-sentence description.
2. **Color band** + disclaimer (specific to this variant ICAO only).
3. **Description** — 1–2 paragraphs sourced from `aircraftVariants.js`: introduction year, capacity, range, engines, what distinguishes this variant.
4. **Operators** — "Operated by N airlines worldwide" + top 10 list (`db.getAircraftOperators([variantICAO])`).
5. **Top routes** — "Flies these top routes:" + top 10 city pairs (`db.getAircraftTopRoutes([variantICAO])`).
6. **Safety** — top-5 events for this variant + full per-variant timeline.
7. **Family link** — "Part of the {family.label} family →".

If the variant has zero observed flights in `observed_routes`, sections 4 and 5 render "No observed flights for this variant in our dataset" instead of empty lists.

## Family page enrichments

`/aircraft/{slug}` (family hub) gains:

- Color band (across all family ICAO codes) + disclaimer
- Top-5 notable events (across the family)
- New "Variants" section listing every variant slug for this family with one-sentence descriptions

`/aircraft/{slug}/safety` gains:

- Color band + disclaimer
- Top-5 (already implied) + decade-grouped full timeline (was previously only a count)
- Per-variant breakdown line: "By variant: 787-8 (3 events), 787-9 (1 event), 787-10 (0 events)"

Existing operators / routes / specs sections are unchanged.

## Error handling

| Condition | Behaviour |
|---|---|
| Variant slug not in catalog | `resolve()` returns `not-found` (404), today's behaviour |
| `safetyRating.colorBand([])` | Returns `{bucket: 'green', label: 'No fatal hull losses on record'}` |
| `db.getFatalEventsByIcaoList` throws | Builder catches, returns null → cache stores null → request falls back to today's H1+subtitle |
| `aircraftVariants.js` mapping is wrong (ICAO not in family) | `aircraftVariants.test.js` fails at boot of test suite — caught in CI |
| `topNotable` produces an empty array (no fatals) | Section is omitted from bake; color band renders green |

The bake layer continues to be a pure enhancement.

## Testing

| File | Coverage |
|---|---|
| `server/src/__tests__/safetyRating.test.js` | `colorBand([])` → green; one test per bucket boundary; `topNotable` sort order; `groupByDecade` correctness; date math is timezone-stable |
| `server/src/__tests__/db.fatalEvents.test.js` | `getFatalEventsByIcaoList` filters severity + icaoList; `getAllEventsByIcaoList` returns all severities; empty icaoList → `[]`; correct order |
| `server/src/__tests__/aircraftVariants.test.js` | Each variant has unique ICAO; each ICAO maps to a family present in `aircraftFamilies.js`; every variant slug is URL-safe (lowercase, alphanumeric + hyphen); every variant has non-empty `description`, `firstFlight`, `capacity`, `range_km`, `engines` |
| `server/src/__tests__/seoMetaService.variant.test.js` | `resolve('/aircraft/boeing-787/variants/787-9')` → `kind: 'aircraft-variant'` with `variant`, `family`, `icaoList`, `colorBand`, `topEvents`; unknown variant slug → `kind: 'not-found'`; resolver populates `colorBand` for aircraft-family kinds too |
| `server/src/__tests__/seoContentBuilders.test.js` (extended) | `bAircraftVariant` renders description, operators, top routes, color band, top-5; `bAircraft` now contains color band + top-5 + variants list; `bAircraftSafety` now contains color band + decade-grouped full list; disclaimer text present on every color-band-rendering builder |
| `server/src/__tests__/index.spaFallback.integration.test.js` (extended) | `GET /aircraft/boeing-787/variants/787-9` → 200, contains `data-seo-bake`, "787-9", color band CSS class, disclaimer text |

All 494 existing tests must remain green.

## Performance

- `aircraftVariants.js` adds ~70 entries × `enumerateSeoUrls()` already runs once at boot and every 6h. ~70 extra `seoMeta.resolve()` calls + ~70 builder calls per warm pass. Each variant builder runs 2-3 SQLite queries. Total warm-pass cost grows by ~5%, negligible.
- Per-request: still one `Map.get`. No additional cost.
- Cache size grows by ~70 entries × ~4 KB (variant pages have richer bake content than route/aircraft) = ~300 KB additional resident memory.

## Sitemap

The sitemap auto-picks up the new variant URLs through `enumerateSeoUrls()`. Per-URL metadata for variants:

| Path pattern | changefreq | priority | lastmod |
|---|---|---|---|
| `/aircraft/{slug}/variants/{variant}` | weekly | 0.6 | aircraftDay (mtime of `aircraftVariants.js`) |

Add a fall-through case to the existing path-mapping switch in `routes/seo.js`.

## Rollout

1. Land the implementation behind no flag — strict superset of current behaviour, degrades gracefully.
2. Deploy.
3. Smoke check: `curl -A 'Googlebot' https://himaxym.com/aircraft/boeing-787/variants/787-9 | grep data-seo-bake` returns a hit, color band class present, disclaimer text present.
4. Search Console — submit `/aircraft/{slug}/variants/{variant}` URL pattern for re-crawl. Validate fix on existing aircraft URLs whose bake is now enriched.
5. Monitor:
   - GSC "Crawled — currently not indexed" trend on aircraft pages — expect drop within 4 weeks.
   - Sentry for any new exception scoped to the new resolver/builder paths.
   - C&D / takedown letters: if any arrive, immediately blank the color band (turn all bands grey + suppress top-5 lists) until methodology is reviewed.

## Open questions

None at design time. Implementation may surface details around:

- Exact CSS color values for the 5 buckets (left to client design follow-up — server bakes a class name; client decides the hex)
- Whether per-variant breakdown on the family /safety page needs a new SQL group-by helper or can be computed in JS from the all-events query result
- Pre-flight check: are there families whose ICAO codes overlap (e.g. a code claimed by two families)? If yes, `aircraftVariants.test.js` will catch it — adjust the catalog before merge.

These are implementation choices, not design decisions.

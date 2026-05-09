# SEO Content Baking — Design

**Date:** 2026-05-09
**Author:** brainstorm session (Denys + Claude)
**Status:** Draft → pending user review

## Problem

Google Search Console reports a growing number of FlightFinder URLs in the
**"Crawled — currently not indexed"** state. The pattern points to thin /
templated content: the site is a React SPA that ships a static `index.html`
with `<title>`, `<meta description>`, and one `<h1>` + one `<p>` swapped per
route by `seoMetaService.inject()`. Everything else inside `<div id="root">`
is identical placeholder markup until JS renders.

For ~100 hub-network route pages and N aircraft pages (plus four subpages
each), Googlebot's first-pass crawl sees ~200 chars of unique body text per
URL. The structural clone-detection then groups them as low-value duplicates
and skips indexing.

## Goal

Make every URL we put in the sitemap return enough unique, indexable HTML
on first byte that Googlebot's first-pass crawl treats it as substantive
and original — without introducing React SSR, breaking the Capacitor mobile
build, or changing the SPA architecture.

## Non-goals

- Full Vite SSR / Next.js migration
- Build-time prerender via headless Chromium
- Improving social-sharing previews beyond what OG tags already do
- Changing client routing, hydration model, or React tree
- Changing the sitemap or robots policy
- Indexing pages that are not currently in the sitemap

## Constraints

1. Capacitor mobile builds (`npm run build:android`, `build:ios`) must keep
   producing the same static SPA bundle. The baked content lives only on
   the web origin and never ships to mobile.
2. No DB query in the hot per-request path.
3. Backwards-compatible: any failure in the baking layer must degrade to
   today's behaviour (H1 + subtitle only) without erroring the response.
4. Re-uses existing data sources (`observed_routes`, `aircraftFamilies.js`,
   safety services). No new data ingestion.

## Architecture

### Request flow

```
GET /aircraft/787
  └─ spaFallback (server/src/index.js)
       ├─ meta        = seoMeta.resolve(req.path)
       ├─ bodyContent = seoContentCache.get(req.path)   // O(1) Map.get
       ├─ html        = seoMeta.inject(indexHtml, meta, bodyContent)
       └─ res.send(html)
```

### Boot flow

```
require('./services/seoContentCache')
  └─ cache.warm()
       ├─ paths = enumerateSeoUrls()
       ├─ for each path:
       │     meta = seoMeta.resolve(path)
       │     html = builders.build(meta, db)        // may return null
       │     if html != null: cache.set(canonical, html)
       └─ setInterval(refresh, REFRESH_INTERVAL_MS)
```

`enumerateSeoUrls()` is extracted from the current `/sitemap.xml` route
into a shared helper so the sitemap and the cache walk the same URL set
(single source of truth).

### Modules

**New**

- `server/src/services/seoContentCache.js` — `Map<canonical_path, html>`,
  exposes `warm()`, `refresh()`, `get(pathname)`, `stats()`.
- `server/src/services/seoContentBuilders.js` — dispatch table keyed by
  `meta.kind`; each builder returns an HTML string or `null`.
- `server/src/services/seoUrlEnumerator.js` — extracted from `routes/seo.js`,
  returns the canonical list of indexable paths. Both the sitemap route
  and the content cache import it.

**Changed**

- `server/src/services/seoMetaService.js` — `inject(html, meta, bodyContent
  = null)` gains a third optional argument. When non-null, it is wrapped in
  `<section data-seo-bake="true">…</section>` and inserted inside `#root`
  immediately after the `<p class="hero-subtitle">` swap. The third
  argument defaults to `null`, preserving today's behaviour.
- `server/src/index.js` — `spaFallback` consults `seoContentCache.get(req.path)`
  before calling `inject()`.
- `server/src/routes/seo.js` — switches to `seoUrlEnumerator` for sitemap
  generation; the URL list is no longer duplicated.

**Untouched**

- All client-side code (React, Vite config, Capacitor)
- `robots.txt`, OG / Twitter tags, JSON-LD
- All other server routes and middleware

## Per-kind content matrix

| `meta.kind`         | Bake content                                                                                          | Data source                                       |
|---------------------|-------------------------------------------------------------------------------------------------------|---------------------------------------------------|
| `route`             | "N airlines fly {from}→{to} · avg {duration} · {distance} · most common: {top3 aircraft} · top operators: {top5 airlines}" | `db.getRouteFacts(from, to)` (new query against `observed_routes`) |
| `aircraft`          | "Operated by N airlines · top routes: {top5} · range {km} · {seats} seats · entered service {year}"   | `db.getAircraftFacts(slug)` (new) + `aircraftFamilies.js` |
| `aircraft-airlines` | Top 20 operators with observed flight counts                                                          | `db.getAircraftOperators(slug)` (new)             |
| `aircraft-routes`   | Top 30 city pairs with frequency                                                                      | `db.getAircraftTopRoutes(slug)` (new)             |
| `aircraft-safety`   | "N incidents on file · most recent: {YYYY-MM-DD} {summary}"                                           | existing safety service                           |
| `aircraft-specs`    | Range, capacity, MTOW, engines, dimensions                                                            | `aircraftFamilies.js` (static)                    |
| `home`              | "Search XX 000 routes worldwide. Filter by aircraft type…" + actual route count                       | hardcoded copy + `db.getRouteCount()`             |
| `by-aircraft`       | List of all families with one-line descriptions                                                       | `getFamilyList()`                                 |
| `safety-global`     | "Dataset spans 1980–YYYY · ~5 200 records · last update YYYY-MM-DD"                                   | `db.getSafetyStats()` (existing or new)           |
| `safety-feed`       | Top 10 most recent NTSB incidents                                                                     | existing `ntsbAdapter`                            |
| `pricing`           | Static paragraphs about plans                                                                         | hardcoded                                         |
| `about`             | Static paragraphs about team / mission                                                                | hardcoded                                         |
| `map`               | Static paragraphs describing the interactive map feature                                              | hardcoded                                         |

Each builder emits final HTML escaped through `seoMeta.esc()`. No template
engine; plain template literals. Long-tail or unknown `kind` returns `null`
(degrades to current behaviour).

## Cache mechanics

- Map is populated synchronously on boot before `app.listen()` returns. The
  warm pass takes ~1-2s for ~300 URLs against SQLite (acceptable for pm2
  restart).
- `setInterval(refresh, 6h)` for the global cache.
- `safety-feed` is the one entry whose data changes daily; it gets a
  separate per-entry `setInterval(1h)` keyed on its canonical path.
- On refresh failure (DB unavailable, builder throws), the existing
  cached value is preserved. We never empty the cache as a side effect of
  a failed refresh.
- Cache size budget: ~300 entries × ~2 KB = ~600 KB resident. Negligible.

## Hydration / client interaction

The client uses `createRoot(...).render(<App/>)` (not `hydrateRoot`), which
unconditionally clears `#root` on mount. The baked `<section
data-seo-bake>` therefore disappears as soon as the JS bundle executes — no
hydration mismatch warnings, no double-rendered content visible to the
user. On slow networks the user sees the baked facts briefly before the
SPA mounts, which is a UX win, not a regression.

If the project ever migrates to `hydrateRoot`, this design must be
revisited (the bake section would have to either match the React tree or
be moved out of `#root`).

## Error handling

| Failure                                  | Behaviour                                              | Logging      |
|------------------------------------------|--------------------------------------------------------|--------------|
| Builder throws or returns null           | Skip that URL; cache stays empty for it; request falls back to today's H1/subtitle-only inject | Sentry warning, scoped per builder + URL |
| DB unavailable during `refresh()`        | Skip iteration; keep prior cached values; reschedule    | Sentry warning |
| `enumerateSeoUrls()` errors at boot      | Fall back to the static-only URL list (the seven top-level pages); warm continues | Sentry warning |
| `seoContentCache.get()` returns null     | `inject()` is called with `bodyContent = null`; current behaviour | none |

The baking layer is a pure enhancement and never blocks a page response.

## Testing

| File                                            | Coverage                                                                                                |
|-------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `server/src/__tests__/seoContentCache.test.js`  | `warm()` populates expected paths; `get()` returns string; `refresh()` updates without clearing; builder errors don't poison other entries |
| `server/src/__tests__/seoContentBuilders.test.js` | For each `kind`, builder against fixture DB returns HTML containing expected key phrases (e.g. "operated by", "range", "airlines fly") |
| `server/src/__tests__/seoMetaService.inject.test.js` | New `describe` block: `inject(html, meta, null)` is byte-equivalent to `inject(html, meta)`; with non-null `bodyContent` the result contains `data-seo-bake="true"` inside `#root`; XSS payload in `bodyContent` survives only if pre-escaped (builders always pre-escape) |
| `server/src/__tests__/index.spaFallback.integration.test.js` | supertest `GET /aircraft/787` body contains "Operated by"; `GET /unknown-path` returns 200 without `data-seo-bake` |
| `server/src/__tests__/seoUrlEnumerator.test.js` | Returns the same path set the sitemap route used to compute, given the same DB state |

All 447 existing jest tests must remain green; `inject()` is
backwards-compatible because the third argument is optional.

## Performance

- Per request: one `Map.get` — sub-microsecond.
- Boot: ~1-2s blocking warm against SQLite for ~300 URLs.
- Refresh: ~150-300 SQLite queries every 6h (and a small subset every 1h
  for `safety-feed`). Rounding error against existing background load.
- HTML payload growth: ~2 KB per URL added to the response. The static
  `index.html` is already ~10-15 KB, so this is a +15-20% page-weight
  increase on baked routes — acceptable, and gzip will recover most of it
  because the baked HTML is highly repetitive.

## Rollout

1. Land the implementation behind no flag (the change is a strict
   superset of current behaviour and degrades gracefully).
2. Deploy to production.
3. Verify `GET /aircraft/787` and `GET /routes/lhr-jfk` return baked HTML
   via `curl -A 'Googlebot'`.
4. Use Search Console "Validate fix" on the affected URL group; reindex
   takes 1-3 weeks.
5. Track "Crawled — not indexed" count in GSC weekly. Expect material
   drop within 4 weeks.

## Open questions

None at design time. Implementation may surface details around:

- Exact Sentry tag taxonomy for builder errors
- Whether `safety-global`'s "dataset stats" needs a new `db.getSafetyStats()`
  helper or can be derived from existing services

These are implementation choices, not design decisions.

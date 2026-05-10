# Internal Linking — SEO Chrome Design Spec

**Date:** 2026-05-10
**Author:** Denys (with Claude as collaborator)
**Status:** Approved scope; ready for implementation plan

## Goal

Wrap every baked SEO page (`<section data-seo-bake>`) with site-wide chrome so Googlebot sees a connected site graph and link equity flows between pages. Currently every page is an isolated content blob with zero internal hrefs — `/routes/jfk-lhr` and `/aircraft/boeing-787/safety` have no links to anything.

Three-layer chrome: **site nav** (header), **breadcrumbs** (per-page), **footer** (top families/routes/safety/about). Plus per-kind **cross-references** to related pages.

## Non-Goals

- No SPA / React refactor. Chrome is bake-only — appears in `<section data-seo-bake>`, hidden from JS users via single CSS rule.
- No SSR / Next.js migration.
- No new resolver or cache layer changes (chrome lives strictly inside `seoContentBuilders.build`).
- No client-side navigation changes (React still owns runtime UX).
- No image/icon assets (text + semantic HTML only).
- No structured-data SiteNavigationElement (defer if needed).
- No sitemap.xml changes (URLs already enumerated).

## Constraints

### UX constraint — flash mitigation

Bake currently lives inside `<div id="root">`. React's `createRoot().render()` wipes `#root` on mount, so users see a brief flash of bake content (~50ms now, ~200-500ms after this feature adds chrome).

**Solution:** add static CSS `section[data-seo-bake="true"]{display:none}` to `client/index.html` `<head>`. Bake stays in HTML for Googlebot; users see nothing.

**SEO risk assessment:** theoretical cloaking penalty is low because (a) bake content is identical data to React content, just rendered differently; (b) pattern used by GitHub, Stack Overflow, many SPAs; (c) revertable in one line if Search Console flags issues.

### Architectural constraints

- `seoContentBuilders.build(meta, db)` stays sync.
- `seoMetaService.resolve()` not modified (chrome operates on meta as-is).
- `spaFallback` request handler not modified (cache returns wrapped HTML).
- Builders (`bAircraft`, `bRoute`, etc.) not modified — chrome wraps their output via single `applyChrome` call in `build()`.

## Architecture

### File structure

**Create**
- `server/src/services/seoChrome.js` — `applyChrome(meta, innerHtml, db)` + 4 private helpers (`_renderSiteNav`, `_renderBreadcrumbs`, `_renderFooter`, `_renderCrossRefs`). Plus per-kind cross-ref dispatchers.
- `server/src/__tests__/seoChrome.test.js` — unit tests for all helpers.
- `server/src/__tests__/db.crossRefHelpers.test.js` — unit tests for 3 new db helpers.

**Modify**
- `client/index.html` — add `<style>section[data-seo-bake="true"]{display:none}</style>` in `<head>`.
- `server/src/services/seoContentBuilders.js`:
  - `build(meta, db)` dispatcher — wrap inner HTML with `applyChrome`.
  - `bHome(_meta, db)` — extend to Rich grid (20 family cards + top-15 routes + safety links).
- `server/src/models/db.js` — add 3 helpers:
  - `getTopRoutesFromAirport(iata, limit)`
  - `getTopRoutesToAirport(iata, limit)`
  - `getTopAircraftBySafetyEventCount(limit)`
- `server/src/services/seoMetaService.js` — extend `structuredData(meta)` to emit `BreadcrumbList` JSON-LD for indexable kinds.
- `server/src/__tests__/seoContentBuilders.test.js` — extend with chrome-wrapping assertions; update existing assertions to accept extra HTML.
- `server/src/__tests__/index.spaFallback.integration.test.js` — extend with E2E chrome tests on home, family, variant, route, safety pages.
- `server/src/__tests__/seoMetaService.variant.test.js` — extend with `BreadcrumbList` JSON-LD assertion.

### Boundaries

- `seoChrome` knows only `meta` + `db`. No FR24, no safety service, no resolver internals.
- Per-kind cross-ref helpers (`_crossRefsForVariant`, `_crossRefsForRoute`, etc.) live inside `seoChrome.js` — kept private, dispatched via switch.
- Builders stay focused on inner content. Chrome is policy applied uniformly via `build()`.

## Component contracts

### `seoChrome.js`

```js
applyChrome(meta, innerHtml, db): string | null
// Returns null if innerHtml is null. Otherwise wraps with chrome.

// Private (per-kind cross-ref helpers also private)
_renderSiteNav(): string                  // module-level const, computed once
_renderBreadcrumbs(meta): string          // dynamic per kind
_renderFooter(db): string                 // 60s memoized
_renderCrossRefs(meta, db): string        // dispatches by meta.kind
_safeChrome(fn, fallback = ''): string    // try/catch wrapper
```

### Site nav

Static, 6 links. Module-level `const SITE_NAV_HTML`:

```html
<nav class="seo-nav" aria-label="Site navigation">
  <a href="/">FlightFinder</a>
  <a href="/by-aircraft">Aircraft</a>
  <a href="/map">Map</a>
  <a href="/safety/global">Safety</a>
  <a href="/about">About</a>
  <a href="/pricing">Pricing</a>
</nav>
```

### Breadcrumbs (per kind)

| Kind | Crumbs |
|---|---|
| `home` | `''` (logo serves as home link) |
| `aircraft` | `Home › Aircraft › <family.label>` |
| `aircraft-variant` | `Home › Aircraft › <family.label> › <variant.shortName>` |
| `aircraft-airlines` | `Home › Aircraft › <family.label> › Operators` |
| `aircraft-routes` | `Home › Aircraft › <family.label> › Top routes` |
| `aircraft-safety` | `Home › Aircraft › <family.label> › Safety` |
| `aircraft-specs` | `Home › Aircraft › <family.label> › Specs` |
| `route` | `Home › Routes › <orig>–<dest>` |
| `aircraft-route` | `Home › Routes › <orig>–<dest> › <family.label>` |
| `safety-feed` | `Home › Safety › Recent events` |
| `safety-global` | `Home › Safety › Global overview` |
| `by-aircraft` | `Home › Browse by aircraft` |
| `map` | `Home › Map` |
| `about`/`pricing`/`legal/*` | `Home › <Label>` |
| `not-found` | `''` (no chrome on 404 — already minimal) |

JSON-LD `BreadcrumbList` mirror added via existing `structuredData(meta)` for indexable kinds.

### Footer

Single universal footer, memoized for 60 seconds (one warm cycle uses one computation). Four sections in HTML:

```html
<footer class="seo-footer">
  <div class="footer-section"><h4>Aircraft families</h4>
    <ul>20 <li><a href="/aircraft/{slug}">{label}</a></li></ul>
  </div>
  <div class="footer-section"><h4>Popular routes</h4>
    <ul>top 30 <li><a href="/routes/{a}-{b}">{A}–{B}</a></li></ul>
  </div>
  <div class="footer-section"><h4>Safety</h4>
    <ul><a href="/safety/global">Global overview</a> + <a href="/safety/feed">Recent events</a></ul>
  </div>
  <div class="footer-section"><h4>About</h4>
    <ul><a href="/about">About</a> + <a href="/pricing">Pricing</a></ul>
  </div>
</footer>
```

### Cross-references (per kind)

| Kind | Cross-refs |
|---|---|
| `home` | none (page is the hub) |
| `aircraft` (family) | "Other {manufacturer} families" — top 5 sibling families by manufacturer, exclude self |
| `aircraft-variant` | "Other variants in this family" — siblings via `getVariantsByFamilySlug`, exclude self |
| `aircraft-airlines/routes/safety/specs` | "More about {family}" — links to overview + 4 sibling subpages, exclude self |
| `route` | "Other routes from {orig}" (top 5) + "Other routes to {dest}" (top 5) |
| `aircraft-route` | Link to `/routes/{pair}` + link to `/aircraft/{slug}` |
| `safety-feed` | Link to `/safety/global` + top 5 most-active family safety pages |
| `safety-global` | Link to `/safety/feed` + top 5 family safety pages |
| `by-aircraft`/`map`/`about`/`pricing`/`legal/*` | none (already covered by site nav) |
| `not-found` | none |

Each helper returns `''` when data is missing — section silently absent. No empty `<ul>` artifacts.

### `applyChrome(meta, innerHtml, db)`

```js
function applyChrome(meta, innerHtml, db) {
  if (!innerHtml) return null;
  if (!meta) return innerHtml;  // defensive

  return [
    SITE_NAV_HTML,
    _safeChrome(() => _renderBreadcrumbs(meta)),
    innerHtml,
    _safeChrome(() => _renderCrossRefs(meta, db)),
    _safeChrome(() => _renderFooter(db)),
  ].filter(Boolean).join('\n');
}
```

Order: nav → breadcrumbs → main content → cross-refs → footer.

## New DB helpers

```js
getTopRoutesFromAirport(iata: string, limit: number): { from, to, count }[]
getTopRoutesToAirport(iata: string, limit: number): { from, to, count }[]
getTopAircraftBySafetyEventCount(limit: number): { aircraft_icao_type, count }[]
```

All three: simple SQL over `observed_routes` / `safety_events` with `GROUP BY` + `ORDER BY count DESC LIMIT ?`. Same guard pattern as `getTopRoutesByObservedFrequency`: `if (typeof limit !== 'number' || limit <= 0) return [];`. IATA inputs validated via `if (!iata) return []`.

## Data flow

```
warm() per 6h:
  for url in enumerateSeoUrls():
    meta = resolve(url)
    innerHtml = bX(meta, db)          ← unchanged
    if (innerHtml) {
      html = applyChrome(meta, innerHtml, db)
      cache.set(url, html)            ← stores wrapped
    } else {
      cache.set(url, null)
    }

request:
  spaFallback(req):
    bodyContent = cache.get(req.path) ← already wrapped
    return inject(template, meta, bodyContent)
```

**Caching:**
- `_renderSiteNav` — module-level const, evaluated at module load. Free.
- `_renderFooter(db)` — 60-sec TTL via simple module-level cache. One DB hit per warm cycle (~250 URLs share same footer).
- `_renderBreadcrumbs(meta)` and `_renderCrossRefs(meta, db)` — not cached (per-page unique).

**Cold start (pm2 reload):** `seoChrome` requires fresh module — `SITE_NAV_HTML` evaluates immediately, footer cache empty. First `applyChrome` call computes footer, caches for 60s. Subsequent ~249 calls in warm cycle reuse cached footer.

## Error handling

| Failure | Behavior |
|---|---|
| `db.getTopRoutesByObservedFrequency` throws inside `_renderFooter` | `_safeChrome` catches → empty routes section, other footer sections render |
| `getFamilyList()` throws | `_safeChrome` catches → empty families section |
| `_crossRefsForX` throws | `_safeChrome` catches → cross-refs aside absent, rest of chrome renders |
| `meta.variant.familySlug` undefined | `_crossRefsForVariant` returns `''` (no throw) |
| `innerHtml = null` | `applyChrome` returns null (no chrome wrap, cache stores null) |
| `meta = null` | `applyChrome` returns innerHtml unchanged (defensive) |
| Per-kind dispatch hits unknown kind | `_renderCrossRefs` returns `''` |
| Per-kind dispatch hits unknown kind for breadcrumbs | falls back to `Home › <kind>` |

Pattern matches existing `_safeDb`, `_safeFr24` conventions.

## bHome Rich grid

`bHome(_meta, db)` extended from 2-paragraph stub to:

1. **Intro** (existing 2 paragraphs).
2. **Aircraft families** (`<h2>` + grid):
   - 20 cards via `_familyCard(f, db)` helper.
   - Per card: family label (linked) + manufacturer + type + operator/route stats (via `getAircraftFacts(icaoList)`).
   - Stats line skipped if no operators in dataset.
3. **Popular routes** (`<h2>` + `<ul>`):
   - Top 15 from `db.getTopRoutesByObservedFrequency(15)`.
   - Each: `<a href="/routes/{a}-{b}">{A}–{B}</a> <small>({count} observed)</small>`.
4. **Safety** (`<h2>` + `<ul>`):
   - Two links: global + feed, with one-line descriptions.

Cost: 20 family cards × 1 `getAircraftFacts` query + 1 top-routes query per warm cycle. Trivially cheap (~21 SQL hits per 6h).

## Testing strategy

### Unit tests (`seoChrome.test.js`)

- `_renderSiteNav` returns string with all 6 expected hrefs; stable across calls.
- `_renderBreadcrumbs` for each kind asserts crumb text + hrefs; XSS-safe.
- `_renderFooter` mock-driven: full render, partial failure (routes throw → families render), cache hit within 60s, cache invalidation after.
- `_renderCrossRefs` per-kind dispatch + edge cases (no siblings → empty, single-manufacturer family → empty, missing endpoint data → empty).
- `applyChrome` orchestration: order, null guards, `_safeChrome` failures don't break full render.
- Total: ~25 unit tests.

### DB helper tests (`db.crossRefHelpers.test.js`)

- `getTopRoutesFromAirport` / `getTopRoutesToAirport`: seed 7 routes, assert top 5 desc; empty input/unknown IATA returns `[]`; limit ≤ 0 returns `[]`.
- `getTopAircraftBySafetyEventCount`: seed 7 ICAOs, assert top 5 with counts.
- Total: ~6 tests.

### Extended builder tests (`seoContentBuilders.test.js`)

- For each kind, `build(meta)` output contains site-nav and footer (sanity).
- `build(meta)` for `home` renders 20 family cards.
- Existing assertions audited — switch any strict equality to `.toContain`/`.toMatch` so chrome wrapper doesn't break them.
- New: `bHome` rich-grid tests.
- Total: ~10 new tests + audit of existing.

### Integration tests (`index.spaFallback.integration.test.js`)

- `GET /` — family grid, popular routes, safety block, site nav, footer all present.
- `GET /aircraft/boeing-787` — breadcrumbs `Aircraft › Boeing 787`, "Other Boeing families" cross-ref, footer.
- `GET /aircraft/boeing-787/variants/787-9` — breadcrumbs include `787-9`, "Other variants" cross-ref includes 787-8 + 787-10.
- `GET /routes/jfk-lhr` — "Other routes from JFK" + "Other routes to LHR" cross-refs.
- `GET /unknown-path` — chrome NOT applied (404 fallback).
- Total: ~5 new tests.

### Structured data test (`seoMetaService.variant.test.js`)

- `structuredData(meta)` for indexable kinds includes `BreadcrumbList` JSON-LD with correct items.
- Total: ~3 new tests.

### CSS test

After build: HTML contains `<style>section[data-seo-bake="true"]{display:none}</style>` in `<head>`. Single regex assertion in spaFallback test or a dedicated client smoke test.

### What we DON'T test

- Visual rendering / browser screenshots (out of scope — pure HTML chrome).
- React hydration interaction (non-issue — `createRoot` wipes `#root`).
- Specific Google ranking impact (impossible pre-deploy).
- 13 kinds × 5 chrome elements as full integration matrix (covered by unit tests + 5 representative integration tests).

### Coverage targets

- `seoChrome.js`: 100% (all helpers, all kinds, error paths).
- New db helpers: 100%.
- `bHome` rich grid: 100%.

### Test count delta

- Unit (seoChrome): ~25
- DB helpers: ~6
- Extended builder: ~10
- Integration: ~5
- Structured data: ~3
- **Total: ~49 new tests.** Baseline 599 → ~648.

## Rollout

1. Land code on a worktree branch following standard subagent-driven flow (spec → plan → tasks → review → merge).
2. Local verify: `npx jest --runInBand` — confirm 599 + ~49 new tests pass.
3. Merge worktree to main, push to origin.
4. pm2 reload + cache.warm. First warm bakes all 250 URLs with chrome (~5-10 sec). FR24 fire-and-forget refresh continues separately.
5. Post-deploy verify (within minutes):
   - `curl -s -A 'Googlebot' https://himaxym.com/aircraft/boeing-787 | grep -c '<nav class="seo-nav"'` → 1
   - `curl -s -A 'Googlebot' https://himaxym.com/aircraft/boeing-787 | grep -c 'Other Boeing'` → 1
   - `curl -s -A 'Googlebot' https://himaxym.com/routes/jfk-lhr | grep -c 'Other routes from JFK'` → 1
   - `curl -s -A 'Googlebot' https://himaxym.com/ | grep -c '/aircraft/boeing-787'` → 1
   - Browse site as user — confirm no flash (CSS hides bake).
6. Monitor Search Console over the next 4-8 weeks for "Crawled — currently not indexed" recovery on aircraft/route URLs.

## Open considerations (non-blocking)

- **Cloaking risk monitoring.** Watch Search Console manual actions panel after rollout. If flagged, revert single CSS line and accept user flash.
- **Footer as N=20 families is hardcoded.** If catalog grows to 30+ families, footer becomes long. Defer pagination/grouping until needed.
- **Cross-ref for `aircraft-route` is minimal.** Could expand to include "Other aircraft on this route" but data depends on `observed_routes` granularity per ICAO — defer.
- **`SiteNavigationElement` JSON-LD.** Could add for structured site nav; defer until Breadcrumbs prove value.
- **Manufacturer-based family filtering**: relies on `f.manufacturer` field in `getFamilyList()` output. Verify field exists during implementation; fall back to type or first-letter grouping if not.

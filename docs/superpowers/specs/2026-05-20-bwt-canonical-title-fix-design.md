# BWT indexation triage — canonical case + title length fix

**Date:** 2026-05-20
**Status:** approved, pending implementation
**Origin:** Bing Webmaster Tools URL Inspection returned "known but not indexed" + "Title too long (1 instance)" on all sampled himaxym.com URLs after IndexNow shipped 2026-05-18 ([[flightfinder-indexnow]]).

## Problem

Bing Webmaster Tools URL Inspection returns the generic verdict:

> *"The inspected URL is known to Bing but has some issues which are preventing indexation."*

on all sampled URLs (good and bad), plus a "Title too long — 1 instance found" callout. IndexNow submissions land cleanly (`status=200 ok=true` on every batch in `/var/log/flightfinder/indexnow.log`), so the failure is **on the page**, not the submission pipeline.

Outside-in audit (curl with `User-Agent: bingbot`) across 13 representative URLs found three actionable defects:

### Defect A — Canonical URL case mismatch (~4,482 URLs)

Sitemap and IndexNow submit lowercase paths. The HTML `<link rel="canonical">` injected by `seoMetaService` uses UPPERCASE for 5 URL kinds:

| Kind | URL Bing crawled | `<link rel="canonical" href="...">` | Count |
|---|---|---|---|
| `/airline/:iata` | `/airline/lh` | `/airline/LH` | 605 |
| `/airline/{iata}/from/{airport}` | `/airline/dlh/from/fra` | `/airline/DLH/from/FRA` | 3,541 |
| `/flights-from/:iata` | `/flights-from/lhr` | `/flights-from/LHR` | 50 |
| `/flights-to/:iata` | `/flights-to/jfk` | `/flights-to/JFK` | 50 |
| `/country/:cc` | `/country/de` | `/country/DE` | 236 |

Total: **~4,482 URLs (≈11% of the 40,399-URL sitemap)** declare their canonical version to be a different URL than the one Bing was told about. Bing's standard handling is "do not index the submitted URL; defer to the canonical." That alone is enough for "known but not indexed."

Same locations in code (all in `server/src/services/seoMetaService.js`):

- L616 — `canonical: ${BASE}/airline/${upper}` (jonty-backed airline meta)
- L681 — `canonical: ${BASE}/flights-from/${upper}` (`airportDeparturesMeta`)
- L703 — `canonical: ${BASE}/flights-to/${upper}` (`airportArrivalsMeta`)
- L724 — `canonical: ${BASE}/airline/${upperAirline}/from/${upperAirport}` (`airlineAirportMeta`)
- L793 — `canonical: ${BASE}/country/${upper}` (`countryMeta`)

For comparison, the correctly-cased builders (L522, L537, L567 — airline×aircraft matrix) explicitly use `.toLowerCase()` on every path segment. The bug is "we computed `upper` for display in the title/H1 and reused the same variable in the canonical."

### Defect B — Title too long (Bing 65-char threshold)

BWT URL Inspection flagged "Title too long: 1 instance found." Audit of all `title:` template strings in `seoMetaService.js` shows multiple templates exceed Bing's 65-character display threshold:

| Template line | Sample produced | Length |
|---|---|---|
| L417 (`/routes/:from-:to`) | "New York to London flights (JFK → LHR) — airlines, aircraft, cheapest dates \| FlightFinder" | **90** |
| L454 (`/routes/:pair/:aircraft`) | "New York to London on the Boeing 737-800 (JFK → LHR) — flights and operators \| FlightFinder" | **~95** |
| L168 (`/aircraft/:family`) | "Boeing 737 (all variants) flights, routes and safety record \| FlightFinder" | **75** |
| L487 (`/airport/:iata`) | "New York John F Kennedy (JFK) — direct flights, airlines, top routes \| FlightFinder" | **~85** |
| L679 (`/flights-from/:iata`) | "Flights from London (LHR) — destinations, airlines, distance \| FlightFinder" | **75** |
| L791 (`/country/:cc`) | "Flights from United States — airports, airlines, popular routes \| FlightFinder" | **78** |

That's ~14K URLs whose titles exceed 65 chars. BWT flags "1 instance" because URL Inspection only inspects one URL at a time — the property-wide count is much higher.

### Defect C — Defensive: `bAirline` placeholder fallback

Not a production defect for sitemap URLs (all 605 `/airline/:iata` URLs in sitemap render correctly via the jonty path), but worth hardening:

`server/src/services/seoContentBuilders.js:1106` emits literal copy `"Network data is being collected."` when `amadeus.getAirlineRoutes(iata)` returns null. Amadeus self-service has 3 deprecated analytics endpoints ([[feedback_amadeus-self-service-prod-deprecations]]) and this is one of them — it returns null in prod for non-jonty airlines. Any future surface that lands on this code path (e.g., obsolete sitemap entry, internal-link drift) would expose placeholder copy to Bing.

## Out of scope

- **/country, /flights-to, /alliance "thin content"** flagged in initial diagnosis — false alarm. Re-measured via `<body>` (not narrow `#root` regex) shows 2.8K-14.6K chars per page. No fix needed.
- **/aircraft/{family}/from/{airport} 404s in sitemap** — separate defect. Affects ≤110 URLs. Will be filed independently if proven impactful after the canonical fix lands.
- **Bing site-wide quality recovery** — engineering can't accelerate this. After fixes land + IndexNow re-submits, expect 2-6 weeks before BWT URL Inspection verdict changes on healthy URLs. Measurement only.
- **Sitemap-index split** (multiple sub-sitemaps vs current single 40K-entry urlset) — would improve BWT "submitted vs indexed" reporting but doesn't fix indexation itself. Future work.

## Design

### Fix A — Canonical lowercase

Direct edit in `server/src/services/seoMetaService.js`. Each of the 5 affected sites computes an `upper` variable for use in title/H1; we need to keep that for display but compute a separate lowercase variant for canonical/URL contexts:

```js
// before (L616)
canonical: `${BASE}/airline/${upper}`,

// after
canonical: `${BASE}/airline/${upper.toLowerCase()}`,
```

Same pattern at L681, L703, L724 (two segments), L793. No new helper — `.toLowerCase()` is unambiguous and one-line.

**Why not redirect uppercase→lowercase at the server?** Considered but rejected. The route handlers already accept both cases (verified — `/airline/LH` returns 200 with content). Adding 301 redirects adds latency for bots and complicates the request flow. Source-of-truth fix at the meta layer is simpler and addresses the bug at the root.

### Fix B — Title length cap

Two-layer approach:

**Layer 1 — Shorten templates per kind.** Manual rewrite of the 6 over-budget templates targeting ≤60 chars (leaves headroom under Bing's 65 limit even for variable substitutions like long country names):

| Line | Before | After (target ≤60) |
|---|---|---|
| L168 | `${label} flights, routes and safety record \| FlightFinder` | `${label} routes & safety \| FlightFinder` |
| L417 | `${fromName} to ${toName} flights (${fromIata} → ${toIata}) — airlines, aircraft, cheapest dates \| FlightFinder` | `${fromIata} → ${toIata}: ${fromName} to ${toName} flights` |
| L454 | `${fromName} to ${toName} on the ${aircraftLabel} (${fromIata} → ${toIata}) — flights and operators \| FlightFinder` | `${fromIata} → ${toIata} on ${aircraftLabel}` |
| L487 | `${name} (${upper}) — direct flights, airlines, top routes \| FlightFinder` | `${name} (${upper}) flights & airlines` |
| L679 | `Flights from ${cityOrIata} (${upper}) — destinations, airlines, distance \| FlightFinder` | `Flights from ${cityOrIata} (${upper})` |
| L701 | `Flights to ${cityOrIata} (${upper}) — origins, airlines, distance \| FlightFinder` | `Flights to ${cityOrIata} (${upper})` |
| L791 | `Flights from ${name} — airports, airlines, popular routes \| FlightFinder` | `${name} — flights & airports` |
| L614, L630 (airline) | `${name} (${upper}) — route network (${routeCount} routes) \| FlightFinder` | `${name} (${upper}) routes & destinations` |
| L356 (variant) | `${v.fullName} — flights, routes and safety record \| FlightFinder` | `${v.fullName} routes & safety` |

The `| FlightFinder` suffix is dropped from the longest templates — Bing handles brand suffix recognition at the SERP level via the new "Brand Information" feature; the explicit suffix on every title is a 2015-era SEO habit and Bing now penalizes title-stuffing patterns.

**Layer 2 — Runtime guard in `seoMetaService.inject()`.** Add a length cap as a safety net for future templates:

```js
function clampTitle(t, max = 65) {
  if (!t) return t;
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}
```

Apply in `inject()` immediately before HTML emission. Logs a one-line warning (`[seo] title clamped from ${len} to ${max}: ${title}`) so future regressions surface in pm2 logs without breaking the page.

### Fix C — Defensive placeholder removal

Replace `seoContentBuilders.js:1106`:

```js
// before
destBlock = `<p>Network data is being collected.</p>`;

// after — fall through to nothing; later sections (hubs, top aircraft,
// destinations from observed_routes) carry the content. If those are also
// empty, the page genuinely has no data and should noindex at the meta layer
// (separate concern handled by route qualification gates).
destBlock = '';
```

Rationale: `bAirline` already has 3 follow-up sections from `airlineAircraftService` (hubs, top aircraft, top destinations) that derive content from `observed_routes` (local, always available). The "being collected" copy is dead — it was a transitional message from before observed_routes existed. Removing it lets the page either render real data or render minimal content (which is then filtered by qualification gates at higher layers).

## Test plan

Tests live alongside the changed files; baseline must stay clean (current: 1316/0/6 from [[flightfinder-indexnow]]).

### New unit tests (must fail before fix, pass after):

```js
// server/src/__tests__/seoMetaService.canonical-case.test.js
describe('canonical URL lowercase invariant', () => {
  for (const kind of ['airline', 'airport-departures', 'airport-arrivals',
                       'airline-airport', 'country']) {
    test(`${kind} canonical has no uppercase letters in path`, () => {
      const meta = resolveMetaForKind(kind);
      const path = new URL(meta.canonical).pathname;
      expect(path).toBe(path.toLowerCase());
    });
  }
});
```

```js
// server/src/__tests__/seoMetaService.title-length.test.js
describe('title length ≤ 65 chars', () => {
  for (const sampleUrl of TITLE_LENGTH_FIXTURES) {
    test(`${sampleUrl} title fits Bing display limit`, () => {
      const meta = seoMetaService.resolve(sampleUrl);
      expect(meta.title.length).toBeLessThanOrEqual(65);
    });
  }
});
```

`TITLE_LENGTH_FIXTURES` covers: `/routes/jfk-lhr`, `/routes/jfk-lhr/boeing-737`, `/aircraft/boeing-737`, `/aircraft/boeing-737/variants/737-800`, `/airport/jfk`, `/flights-from/lhr`, `/flights-to/jfk`, `/country/us`, `/country/united-states`, `/airline/lh`.

### Smoke validation on prod after deploy:

```bash
for url in /airline/lh /flights-from/lhr /flights-to/jfk /country/de \
           /airline/dlh/from/fra /routes/jfk-lhr /aircraft/boeing-737; do
  echo "== $url =="
  curl -sA bingbot "https://himaxym.com$url" \
    | grep -iE '<title>|rel="canonical"' \
    | head -2
done
```

Pass criteria:
- All canonical hrefs match the URL (lowercase path)
- All titles ≤65 chars

## Rollout

1. Implement fixes A, B, C in a single branch.
2. Run full test suite locally; target clean baseline 1316/0/6.
3. Smoke 5 URLs each kind via local dev server.
4. Push to main → automatic deploy.
5. Verify on prod with the smoke command above.
6. **Trigger an IndexNow full re-submission manually** to push the corrected canonical signal:
   ```bash
   ssh hetzner 'export INDEXNOW_KEY=$(cat /etc/flightfinder/indexnow.key) \
     && cd /root/flightfinder \
     && node server/scripts/submit-indexnow.js --mode=full \
     >> /var/log/flightfinder/indexnow.log 2>&1'
   ```
   (Daily cron at 03:15 UTC will re-submit anyway, but manual run shortens the feedback loop.)
7. Add the BWT property if not already added — use the IndexNow key file for instant verification ([[flightfinder-indexnow]] confirms the key endpoint is healthy).
8. Re-check 5 sample URLs via BWT URL Inspection at +7 days and +21 days post-deploy.

## Risk

- **R1 — Title rewrites lose keywords.** Mitigation: the rewrites preserve the primary entity (route pair, aircraft family, airport name) and drop only stuffing modifiers ("airlines, aircraft, cheapest dates"). H1 and meta description remain unchanged and still carry the long-tail keywords for search context.
- **R2 — Existing tests assert old titles.** Audit pass: search for the old title literals in `__tests__/`. Update fixtures atomically with the production strings.
- **R3 — Cloudflare cache serves stale HTML.** Mitigation: the page-cache layer keys on URL not content; pushing new builds + IndexNow re-submit will cause Bingbot to refetch and pick up the new headers. Optionally `wrangler purge` after deploy, but the cache TTL is short enough that it'll roll over within hours.
- **R4 — Bing doesn't re-evaluate immediately.** Expected. The fix is necessary but not sufficient for instant indexation. Expect a 2-4 week observation window before BWT URL Inspection verdicts change.

## Validation criteria (definition of done)

- [ ] All 5 affected builders emit lowercase canonical
- [ ] All `seoMetaService` title templates produce ≤65 chars on the worst-case substitution
- [ ] Runtime `clampTitle` guard in place + warns in logs on overflow
- [ ] `seoContentBuilders.js:1106` no longer emits the placeholder string
- [ ] New unit tests pass; baseline 1316/0/6 maintained
- [ ] Prod smoke confirms canonical+title on 7 representative URLs
- [ ] IndexNow re-submission triggered post-deploy; `status=200` in log
- [ ] BWT property added (one-time, manual); URL Inspection bookmarked for 5 sample URLs

## Open questions

1. **Should we drop the `| FlightFinder` brand suffix everywhere or keep on shorter templates?** Current proposal: drop only where it breaks the 65-char budget. Consistent presence elsewhere preserves brand reinforcement in SERPs.
2. **`Intl.DisplayNames('en').of('US')` returns "United States" (13 chars) but `.of('GB')` returns "United Kingdom" (14 chars) and `.of('CD')` returns "Congo - Kinshasa" (16 chars).** With the proposed L791 rewrite (`${name} — flights & airports`) the worst case is ~32 chars — well within budget. No conditional formatting needed.
3. **Do we want a fail-loud test that scans every enumerated SEO URL through `seoMetaService.resolve` and asserts title ≤65?** Pro: catches future regressions across all 40K URLs. Con: ~30s added to test suite. Recommendation: yes, gate behind `RUN_FULL_SEO_AUDIT=1` env var so it doesn't slow normal CI but is one command away.

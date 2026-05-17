# Aircraft Landing — Ultra-Rich Content for Boeing 737 + A320 family — Design

## Goal

Enrich `/aircraft/boeing-737` and `/aircraft/airbus-a320-family` with hand-curated content blocks (variants table, notable accidents, variant-family narrative, expanded FAQ) so they become the best aviation-keyword landing pages for these high-volume terms. Other aircraft pages keep the existing template unchanged.

## Background

Current state (`AircraftLandingPage.jsx` template + `bAircraft()` SSR):
- ~600-700 words per page
- 8 H2/H3 sections: About, Who flies it, Recent safety events, Where does it fly, Top routes, Top operators, FAQ (template-driven), Other aircraft
- FAQPage + BreadcrumbList schema present

Limitations:
- No variant breakdown (737-700/800/900/MAX 7/8/9/10 invisible — these are real query targets)
- No notable accident narrative (Lion Air 610, Ethiopian 302, AirAsia 8501 each have their own search volume)
- No 737 MAX / A320neo dedicated callout (MAX grounding is the highest-volume 737-related query)
- FAQ is generic template — same questions every aircraft

## Architecture

Data-driven enrichment with **shared content file** between server SSR and client hydration:

- `server/src/content/aircraftLandingContent.json` — hand-curated content per slug
- `bAircraft()` in `seoContentBuilders.js` reads the file and inlines new blocks BEFORE the existing template HTML
- `AircraftLandingPage.jsx` reads the same JSON (via require) and renders the same blocks for hydrated/CSR view

If a slug is not in the JSON, fall through to the existing template — zero impact on other aircraft pages.

## Content blocks (each rendered only when present in JSON)

### 1. Variants table

`H2: Variants and specifications`

Columns: **Variant | First flight | Typical seats | Range | Status**.

- Boeing 737 rows: 737-700, 737-800, 737-900, MAX 7, MAX 8, MAX 9, MAX 10
- A320 family rows: A319, A319neo, A320, A320neo, A321, A321neo, A321LR, A321XLR

Hand-curated values from manufacturer published specs. Schema: `ItemList` of `Product` (one per variant) — gives Google rich results for variant-specific queries.

### 2. Notable accidents

`H2: Notable accidents and incidents`

Sorted by fatalities DESC, ≤5 rows. Each row: date, flight number, operator, aircraft variant, fatalities, 1-2 sentence context, internal link to `/accidents/{slug}` when narrative exists.

- Boeing 737: Lion Air 610 (189), Ethiopian 302 (157), Aeroflot 1492 (41), Air China 6649 historic
- A320 family: AirAsia 8501 (162), Germanwings 9525 (150), US Airways 1549 (Hudson, 0 fatal — historic)

Distinct from "Recent safety events" (which is date-ordered and includes minor incidents).

### 3. Variant callout

`H2: About the [variant family]`

100-200 words hand-written narrative. Markdown allowed for sub-paragraphs and emphasis.

- Boeing 737: "About the 737 MAX" — MCAS, grounding 2019, return to service 2021, current status, recent incidents
- A320 family: "About the A320neo family" — sharklets, fuel efficiency, A321XLR transatlantic capability, current order book

### 4. Expanded FAQ

Replaces (not appends to) the template's generic FAQ for slugs with custom content. Hand-written Q&A:

1. "Is the [aircraft] safe?" — with concrete numbers
2. "How many fatal accidents has the [aircraft] had?" — with numbers
3. "Which airline has the largest [aircraft] fleet?" — with carrier name
4. "What's the difference between [variant1] and [variant2]?"
5. "How many seats does a [aircraft] have?" — variant range
6. "When was the [aircraft] introduced?"

All 6 Q&A flow into the existing `FAQPage` schema generator (already a-OK in current code), so they become rich Google results.

## SEO additions

- `ItemList` schema with `Product`-typed variants
- Each notable incident with `Article` schema (date, headline, link to /accidents/{slug}). Plus link-cluster.
- Existing `FAQPage` schema picks up the 6 new questions automatically.
- Existing `BreadcrumbList` unchanged.

## Files

### CREATE

- `server/src/content/aircraftLandingContent.json` — `{ "boeing-737": {...}, "airbus-a320-family": {...} }`
- `server/src/__tests__/aircraftLandingContent.test.js` — tests for new SSR blocks (presence, schema, fallback)

### MODIFY

- `server/src/services/seoContentBuilders.js` — `bAircraft()` reads JSON, renders 4 new blocks when slug matches
- `client/src/components/AircraftLandingPage.jsx` — imports JSON, conditionally renders blocks
- `client/src/components/AircraftLandingPage.css` — `.variants-table`, `.notable-incidents`, `.variant-callout`, expanded FAQ styling

### DO NOT TOUCH

- `aircraftFamilies.js` model — variant data lives in the content JSON, not the family model (which is for ICAO code resolution, not display)
- `safetyEvents` / `aircraftSafetyService` — Recent Safety Events block stays date-ordered as today
- Other 19 aircraft landing pages — unchanged behavior

## Out of scope (v1)

- Auto-generation of content for other aircraft (requires per-aircraft research, separate plan)
- Photographs / livery images (image rights + alt-text quality is a separate project)
- Per-operator deep-link cluster (`/airline/{icao}/aircraft/{type}`) — track 3 from prior SEO discussion
- A/B testing the new content blocks
- Updating Bing Webmaster / Yandex sitemap

## Reversibility

JSON-driven. Removing a slug entry from `aircraftLandingContent.json` reverts that page to the template. Deleting the JSON file reverts both pages. No schema migrations, no destructive changes.

## Acceptance criteria

- `/aircraft/boeing-737`: word count > 1500 (currently ~700); has 4 new H2 sections; FAQPage schema contains all 6 new Q&A; variants table SSR'd in HTML
- `/aircraft/airbus-a320-family`: same metrics
- `/aircraft/boeing-787` (control): unchanged — same HTML as before this change
- All seoContentBuilders.test.js cases pass; 5+ new cases for the enrichment path

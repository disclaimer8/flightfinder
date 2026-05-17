# Airport & Route SEO content strategy

**Date:** 2026-05-17
**Status:** Strategy draft, awaiting engineering implementation plan
**Owner:** Denys
**Related specs:** `2026-05-16-flightconnections-crawler-design.md` (data acquisition for FC source)

## Goal

Stand up a new family of SEO content on himaxym.com powered by airline-route data, capturing four high-intent search clusters we currently leave on the table: **airport landing**, **route detail**, **airline network**, and **aircraft × route**. The unique asset is *aircraft type per airline per route* from the FlightConnections crawl — no incumbent (flightconnections.com, flightsfrom.com, airline sites, Wikipedia) exposes the cross of all four dimensions.

## Non-goals

- Implementation. This is taxonomy + content design only; engineering writes the build/bake plan.
- Localization. EN-only per the crawler-scope decision; hreflang single-locale only.
- Booking funnel design. Pages link to existing search and Stripe upsell, not new commerce.
- Real-time data. Pages render baked weekly snapshots; live availability is the in-app product, not the SEO surface.

## What's already in place (audit summary)

| Area | Current state |
|---|---|
| URL roots indexed | `/aircraft/{family}`, `/aircraft/{family}/variants/{v}`, `/aircraft/{family}/{routes\|airlines\|safety}`, `/routes/{a}-{b}`, `/routes/{a}-{b}/{aircraft}`, `/safety/*`, `/accidents/*`, `/by-aircraft`, `/map` |
| Pages in sitemap | ~1 200 (per sitemap probe); aircraft 14 × ~5 + routes (3 468 observed) + airports (~140) + airlines (~120) + safety. **No airport-landing page family, no airline-network page family.** |
| Rendering | Hybrid: navigation + bake content SSR; live search shell is client-rendered. Aircraft & route pages are SSR-baked (visible in view-source). |
| Schema.org observed on existing pages | None detected on `/aircraft/boeing-737` or `/routes/lhr-jfk` view-source — **gap**. Existing FAQ blocks could already be wearing FAQPage but aren't. |
| Existing route page (`/routes/lhr-jfk`) shape | Title + H1 + thin FAQ + boilerplate "what you can do on Flight Finder" + popular routes nav. **Currently thin.** Lacks airlines list, aircraft list, distance/duration table, schedule. Direct gap vs FC's ~3 000-word equivalent. |
| Existing aircraft page (`/aircraft/boeing-787`) shape | Strong: variants, accidents, top routes for type, operator list, FAQ. This is the template for cross-family content depth. |
| Robots.txt | Permissive root, blocks `/api/`, `/src/`, `/.vite/`, UTM/ref/fbclid/gclid params. Sitemap declared. Healthy. |
| Lazy-bake regex (`seoContentCache.isLazyPath`) | Per FF memory note, *must* be updated for every new SSR URL family. **Critical trap** — adding new families without this triggers Soft 404. |

### Competitive SERP read (sampled May 2026)

| Query | Page 1 winners | Format archetype |
|---|---|---|
| `flights from cork` | corkairport.com (official), skyscanner.ie, flightconnections.com, flightsfrom.com, google flights, aer lingus, expedia | Official airport site dominates; aggregators (FC, FF) ride alongside; Skyscanner owns commercial intent |
| `aer lingus routes from cork` | aerlingus.com, flightsfrom.com `/ORK/EI`, corkairport.com | Carrier owns brand; flightsfrom.com owns the *airline×airport* slice we want to challenge |
| `boeing 787 routes` | gotravelyourway.com, simpleflying.com, Wikipedia "List of 787 operators", aviationweek, airportspotting | **No incumbent owns aircraft×route systematically** — blog-style listicles only. Big opportunity. |
| `lhr to jfk flights` | flightstats, virginatlantic, flightaware, flightconnections | Airline + aggregators; no canonical "this route" resource with aircraft breakdown |

**Implication:** airline-network and route-detail SERPs are crowded with carriers + aggregators (hard fight). Aircraft × route SERPs are owned by blog content only (easy to leapfrog with structured data). Airport-landing is dominated by official airport sites — we win the *secondary* "from-X-to-Y / by-airline / by-aircraft" cuts they don't slice.

## 1. Page taxonomy

| Family | URL pattern | Est. pages | Data source | Phase |
|---|---|---|---|---|
| Airport landing (departures) | `/flights-from/:iata` | ~4 000 | Jonty (P1), FC enrich (P2) | P1 |
| Airport landing (arrivals) | `/flights-to/:iata` | ~4 000 | Jonty (P1), FC enrich (P2) | P1 |
| Route detail (existing, expanded) | `/routes/:from-:to` | ~59 000 directed (Jonty) → ~150 000–200 000 (FC) | Jonty (P1), FC enrich (P2) | P1 expand existing |
| Airline network (hub-and-spoke) | `/airline/:iata` | ~900 carriers (FC), ~600 with ≥10 routes (Jonty) | Jonty (P1), FC enrich (P2) | P1 |
| Airline × airport | `/airline/:airline-iata/from/:airport-iata` | ~900 × avg 25 hubs ≈ 22 000 (gated by ≥3 routes threshold) | Jonty (P1) | P1 |
| Aircraft × route index (existing, expanded) | `/aircraft/:family/routes` | 14 (current), expand to ~40 with FC | Existing + FC | P2 |
| Aircraft × airport | `/aircraft/:family/from/:iata` | 40 families × ~150 hubs that operate it ≈ 6 000 (gated by ≥2 carriers) | FC only | P2 |
| Aircraft on specific route (existing) | `/routes/:from-:to/:aircraft` | ~5 000 (existing) → ~50 000 (FC enables) | FC | P2 |
| Country hub | `/flights-from/country/:iso2` | ~200 | Jonty | P3 |
| Alliance map | `/alliance/:slug` (oneworld, skyteam, star-alliance) | 3 | FC | P3 |

**Page count totals:** Phase 1 ships ~30 000 new SSR-baked URLs (excluding route detail expansions, which are upgrades to existing). Phase 2 adds ~80 000 (most via aircraft cross-cuts and FC-driven route expansion). Phase 3 a few hundred curated.

**Gating rules to avoid thin pages:**
- Airport pages require ≥1 destination served year-round.
- Airline pages require ≥10 routes.
- Airline×airport require ≥3 routes.
- Aircraft×airport require ≥2 carriers using that type from that airport (avoids "BA-only A380 from LHR" duplicates).
- Route pages with only seasonal/charter data and no airline list get `noindex` + `<meta robots="noindex,follow">` (keeps internal link equity flowing) until FC confirms.

## 2. Per-family content design

### 2.1 `/flights-from/:iata` — airport landing (departures)

| Element | Spec |
|---|---|
| Title | `Flights from {city} ({iata}) — {n_destinations} destinations on {n_airlines} airlines \| FlightFinder` (≤ 60 chars; truncate "destinations" → "stops" if needed) |
| Meta description | `Compare all {n_destinations} non-stop destinations from {city} {iata}, with {n_airlines} airlines and aircraft types on each route. Updated {iso_week}.` (≤ 160) |
| H1 | `Flights from {city} ({iata})` |
| Above-fold | (1) Facts strip: city, country, IATA/ICAO, lat/lon, timezone, elevation, total destinations, total airlines, longest non-stop, shortest non-stop. (2) "Search flights from {city}" CTA → in-app search pre-filled with origin. (3) Top 10 destinations table (city, IATA, airlines count, weekly frequency, distance). |
| Below-fold | (a) **Full destination list** as sortable HTML table (city, country, airlines, aircraft types, frequency, distance, duration) — bake **all** rows, no pagination, no JS-gated reveal (crawlable). (b) **Airlines flying from {city}** list with link to `/airline/{iata}/from/{airport}`. (c) **Aircraft types operating from {city}** with link to `/aircraft/{family}/from/{airport}` (**USP block** — no incumbent does this slice on airport pages). (d) **Safety overlay**: 12-month incident count from FF accident DB for flights departing this airport, with link to `/safety/airports/{iata}` (future) or filtered safety feed. (e) Geography section: city/country/region context, alternative airports within 100km. (f) FAQ (6–10 Qs from PAA): "How many airlines fly from {city}?", "What is the longest flight from {iata}?", "Which terminal does {top_airline} use at {iata}?", "Does {iata} have direct flights to the US?". (g) "Last updated" + data-source attribution. |
| Internal links in | `/routes/:from-:to` (every destination row), `/airline/:iata` (every airline), `/airline/:iata/from/:iata` (carrier+origin cell), `/aircraft/:family/from/:iata` (aircraft cell), nearby airports list (sibling airport pages). |
| Internal links out (page receives) | `/routes/:from-:to` reverse (origin chip), `/airline/:iata` (hubs section), homepage hub list (top-50 airports), country hub page. |
| Schema.org | `Airport` (name, iataCode, icaoCode, address, geo, elevation), `BreadcrumbList`, `FAQPage`, `ItemList` for destinations (top-20 only — `ItemList` over ~50 is ignored by Google). **Avoid** `Place` + `Country` confusion (see FF memory `feedback_seo-schema-validator-traps`). |
| Canonical | Self `https://himaxym.com/flights-from/{iata}` |
| Hreflang | `en` self only |
| Indexability | SSR-baked, in sitemap, **add to `seoContentCache.isLazyPath` regex** (recurring trap) |

### 2.2 `/flights-to/:iata` — airport landing (arrivals)

Same shape as 2.1 but inverted (origins flying *into* the airport). Differentiate the title/H1/meta to avoid duplicate content with `/flights-from`: emphasize "Where can you fly from to reach {city}?" framing. Schema same `Airport` root.

| Element | Spec |
|---|---|
| Title | `Flights to {city} ({iata}) — {n_origins} airports, {n_airlines} airlines \| FlightFinder` |
| H1 | `Flights to {city} ({iata})` |
| Differentiator | Above-fold reverses to "Top 10 origin cities" + "From which cities can you reach {city} non-stop?" FAQ. Body table sorts by origin city, not destination. |

### 2.3 `/routes/:from-:to` — route detail (existing, upgrade)

Current page is thin. Upgrade in-place.

| Element | Spec |
|---|---|
| Title | `{from_city} to {to_city} flights ({iata1} → {iata2}) — {n_airlines} airlines, {n_aircraft} aircraft types \| FlightFinder` |
| Meta | `Direct flights from {from_city} to {to_city}: {n_airlines} airlines, {distance_km} km in ~{duration}. See aircraft types, schedule, and safety record.` |
| H1 | `{from_city} to {to_city} flights ({iata1} → {iata2})` |
| Above-fold | Facts strip (distance km/mi, duration, airlines count, weekly flights, aircraft type count, direct/connecting flag), "Search this route" CTA, airlines list with logos. |
| Below-fold | (a) **Airlines table** (airline, weekly flights, aircraft types used, alliance) — link each row to `/airline/:iata`. (b) **Aircraft types on this route** — table of every aircraft type with operators (**USP block**: "Want to fly the 787 on this route? Only ANA and BA use it"). Link to `/aircraft/:family`. (c) **Schedule overview**: day-of-week heatmap (FC data), seasonality flag (year-round / summer-only / winter-only / charter). (d) **Safety overlay**: any incidents on this exact route in last 10 years; if aircraft type ever involved in incident, surface as "aircraft history" with link to accident records. (e) **Geographic context**: map (existing), great-circle distance, timezone delta. (f) **Reverse direction** link to `/routes/:to-:from`. (g) FAQ: "How long is the flight from X to Y?", "Which airlines fly direct from X to Y?", "What aircraft is used on the X-Y route?", "Is there a non-stop flight from X to Y?", "How many flights per week from X to Y?" |
| Internal links in | Both airport landing pages, both airline pages, every aircraft family used, alliance pages. |
| Schema | `Place` for origin & destination, `BreadcrumbList`, `FAQPage`. **No** `Flight` schema with offers (we don't have prices; faking offers = Google penalty per memory note `seo-schema-validator-traps`). Use `Trip` only if we can populate `itinerary` cleanly. |
| Canonical | Self. **Decision:** route is directed; `/routes/lhr-jfk` and `/routes/jfk-lhr` are *not* canonical to each other (different origins, different schedules). Cross-link explicitly via "Reverse direction" rel=alternate? No — keep as plain link; rel=alternate is for hreflang only. |
| Indexability | SSR-baked, existing in sitemap. Confirm lazy-bake regex still covers `/routes/:from-:to` and the new `/routes/:from-:to/:aircraft` (existing pattern). |

### 2.4 `/airline/:iata` — airline network

New family. The slug uses **IATA** (2-letter, e.g. `/airline/ei` for Aer Lingus). Note: per FF memory `observed-routes-airline-column-icao`, the `observed_routes.airline_iata` column actually stores ICAO codes — **builder must use `getAirlineByIcao`** when reading from that table, then publish the page at the IATA slug. Critical to flag in the implementation spec.

| Element | Spec |
|---|---|
| Title | `{Airline} ({iata}) routes & destinations — {n_destinations} airports in {n_countries} countries \| FlightFinder` |
| Meta | `{Airline} flies to {n_destinations} airports across {n_countries} countries on {n_aircraft} aircraft types. See the full route map, hubs, and fleet.` |
| H1 | `{Airline} ({iata}) — routes and destinations` |
| Above-fold | Logo + facts strip (IATA, ICAO, callsign, hub airports, alliance, fleet size, destinations count, countries count), CTA "Search {Airline} flights". |
| Below-fold | (a) **Hubs** — list with route count per hub, link to `/airline/{iata}/from/{hub_iata}`. (b) **Full destinations** table (city, country, weekly freq, aircraft types). (c) **Fleet × routes** matrix (USP): rows = aircraft type, cols = top routes; cell = freq. Link rows to `/aircraft/{family}`. (d) **Top routes** ranked by frequency. (e) **Safety record** from FF accident DB, with link to airline safety page if it exists, else gracefully omit (don't fabricate). (f) FAQ: "Where does {Airline} fly?", "What's {Airline}'s main hub?", "What aircraft does {Airline} fly?", "Is {Airline} a member of an alliance?", "How many destinations does {Airline} have?" |
| Internal links in | `/airline/:iata/from/:airport-iata`, every `/routes/:from-:to`, hub airport `/flights-from/:iata`, every `/aircraft/:family`, alliance page. |
| Internal links out (page receives) | Every airport landing page (in their airline list), every route detail (in airline list), alliance page. |
| Schema | `Airline` (name, iataCode, icaoCode), `BreadcrumbList`, `FAQPage`, optional `Organization` w/ logo. |
| Canonical | Self |
| Indexability | SSR-baked, in sitemap, add to lazy-bake regex |

### 2.5 `/airline/:airline-iata/from/:airport-iata` — airline × airport

| Element | Spec |
|---|---|
| Title | `{Airline} routes from {city} ({iata}) — {n_destinations} destinations \| FlightFinder` |
| Meta | `Every {Airline} flight from {city} {iata}: {n_destinations} non-stop destinations, aircraft types per route, weekly frequency.` |
| H1 | `{Airline} flights from {city} ({iata})` |
| Above-fold | Facts: destinations from this hub, weekly frequency, aircraft types used, busiest route. CTA → search pre-filled with origin + airline filter. |
| Below-fold | (a) Destinations table (destination city, weekly freq, aircraft, distance, duration). (b) "Other airlines from {city}" cross-link. (c) "Other {Airline} hubs" cross-link. (d) FAQ: "What destinations does {Airline} serve from {city}?", "Which terminal does {Airline} use at {iata}?" |
| Schema | `BreadcrumbList`, `FAQPage`, `ItemList` (top-20 destinations). |
| Canonical | Self |
| Indexability | SSR-baked, in sitemap, lazy-bake regex |

### 2.6 `/aircraft/:family/routes` — aircraft × route (existing, expand)

Already exists for 14 families. Expand to ~40 with FC `aircraft_routes.json` reverse index. Same template as current; add airline-per-route column and frequency.

### 2.7 `/aircraft/:family/from/:iata` — aircraft × airport (new, P2)

**This is our highest-differentiation page family.** No incumbent owns "where does the 787 fly from LHR" or "which 737 routes leave Cork".

| Element | Spec |
|---|---|
| Title | `{Aircraft} flights from {city} ({iata}) — {n_routes} routes on {n_airlines} airlines \| FlightFinder` |
| Meta | `Every {Aircraft} flight from {city} {iata}: {n_airlines} airlines, {n_routes} destinations. Filter routes by aircraft type.` |
| H1 | `{Aircraft} flights from {city} ({iata})` |
| Above-fold | Facts: routes, airlines, weekly frequency on this type. CTA → search pre-filled with origin + aircraft. |
| Below-fold | (a) Routes table (destination, airlines using this type, weekly freq, duration). (b) "Other aircraft from {city}" cross-link to siblings. (c) "Where else does {Aircraft} fly from?" linking to top-10 sibling hubs. (d) Aircraft spec sidebar (cribs from `/aircraft/{family}`). (e) FAQ: "Which airlines fly the {Aircraft} from {city}?", "Where can I fly on a {Aircraft} from {iata}?" |
| Schema | `BreadcrumbList`, `FAQPage`, `ItemList`. |
| Canonical | Self |
| Indexability | SSR-baked, in sitemap, lazy-bake regex |

### 2.8 `/routes/:from-:to/:aircraft` — aircraft on specific route (existing)

Already exists. Expansion is data-volume only (FC adds ~10× more aircraft × route combos). Template unchanged.

### 2.9 `/flights-from/country/:iso2` — country hub (P3)

| Element | Spec |
|---|---|
| Title | `Flights from {country} — airports, airlines, destinations \| FlightFinder` |
| H1 | `Flights from {country}` |
| Body | List airports in country, ranked by traffic; for each, link to `/flights-from/:iata`. Top international destinations. Top airlines (national carriers featured). |
| Schema | `BreadcrumbList`, `FAQPage`, `ItemList` of airports. **No** `Country` schema (Google validator trap per memory note). |

### 2.10 `/alliance/:slug` — alliance map (P3)

Three pages total (oneworld, skyteam, star-alliance). Member airlines, combined network reach, code-share routes. Schema `Organization` + member list.

## 3. Distinctive content (anti-duplicate, helpful-content moat)

| Moat | Surface |
|---|---|
| **Aircraft × airline × route trifecta** (USP) | Aircraft column on every route table, every airport destination table, every airline destination table. Dedicated `/aircraft/:family/from/:iata` family. No other site cross-cuts all three. |
| **Cross-source agreement signal** | Each route gets a small "Data agreement" badge: ✓ confirmed by 2 sources (Jonty + FC), ⚠ only in Jonty (community), ⚠ only in FC (crawl). This is *Trust* signal (E-E-A-T) competitors cannot reproduce. |
| **Safety overlay** | FF already owns 40 000+ accident records + NTSB ingest. Every route page surfaces "incidents on this aircraft type on this route" or "incidents from this airport". This is the **single biggest E-E-A-T differentiator** vs flightconnections.com (which has zero safety data). |
| **Freshness stamp** | "Updated {iso_week} from {sources}" — visible on page + in JSON-LD `dateModified`. Jonty refreshes weekly; FC ~monthly. Per-page freshness is honest, not a lie like "updated daily". |
| **Aviation context, not booking pressure** | Competitors (Skyscanner, Expedia) push price urgency. FF pages are reference content: "here's what flies, on what, when". Different intent funnel, friendlier to AI overview citation (per AEO research: data-led content + statistics gets cited ~30–40% more). |
| **Embedded data, lifted by AI** | FAQ answers are written as standalone factual sentences with the number inline ("Cork airport (ORK) has 8 airlines flying to 47 non-stop destinations as of week 20 2026"). Ideal for ChatGPT/Perplexity lifts and AI Overviews. |
| **Reverse indices** | `aircraft_routes.json` lets us answer "where can I fly on a 787" from any direction. Build that into both content (aircraft × airport pages) and an internal search facet later. |

## 4. Sitemap + crawl strategy

### 4.1 Sitemap topology

Split sitemap into 8 chunks (max 50 K URLs each per Google limit; we land well under but split for crawl diagnostics):

```
/sitemap.xml                    (sitemap index)
  /sitemap-airports.xml         (~8 000  — both /flights-from & /flights-to)
  /sitemap-routes.xml           (~60 000 in P1; ~200 000 in P2 — split further if needed)
  /sitemap-airlines.xml         (~900)
  /sitemap-airline-airport.xml  (~22 000)
  /sitemap-aircraft.xml         (~40 + ~6 000 cross-cuts)
  /sitemap-safety.xml           (existing)
  /sitemap-core.xml             (homepage, /pricing, /about, /by-aircraft, /map)
  /sitemap-country-alliance.xml (~200 + 3, P3)
```

Each sub-sitemap declares `<lastmod>` per URL, set to the latest source-data refresh that touched the page.

### 4.2 What ships in sitemap vs robots-allow-only

- **In sitemap:** all gated-not-thin pages (per §1 gating rules).
- **Robots-allow but not in sitemap:** sub-threshold pages (airlines with <10 routes, airline×airport with <3 routes, aircraft×airport with <2 carriers) — keep them crawlable for internal-link discovery, but signal we don't promote them. Add `<meta name="robots" content="noindex,follow">` if they're truly thin.
- **Robots-disallow:** none for new families. The existing `/api/` `/src/` `/.vite/` UTM/ref blocks stay.

### 4.3 Crawl budget priority

Google's effective crawl budget on a DR ~20 domain is small. Phased exposure:

1. Week 1 of P1: ship top-50 airport pages + their direct routes + top-100 airlines only (≈ 5 000 URLs in sitemap). Watch Search Console "Discovered – not indexed" rate.
2. Week 3–4: expand to top-500 airports + all airlines with ≥30 routes.
3. Week 6: full P1 inventory in sitemap.
4. P2 (post-FC): same staged release — top-100 aircraft×airport first, full inventory after 2 weeks.

### 4.4 Internal link graph

Hub-and-spoke with controlled mesh:

- **Hub layer:** homepage → top-50 airport pages, top-30 airlines, top-15 aircraft families. (Existing footer pattern, expand.)
- **Spoke layer:** every airport page links to its destination routes, airlines, aircraft types (3-way mesh per airport).
- **Cross-mesh:** every route page links *back* to its two airports + every airline + every aircraft type on it (the route page becomes a hub itself for ~10–20 links).
- **Anchor variety:** vary anchor between `{city}-{city}`, `{iata}-{iata}`, `flights from {city} to {city}`, `{city} to {city} on {airline}`. Per family, define 4 anchor patterns rotated by hash of source URL to avoid over-optimization while staying natural.

## 5. Phased rollout

### Phase 1 — Ships now (Jonty data only)

| Family | Pages | Notes |
|---|---|---|
| `/flights-from/:iata` | ~4 000 | Stage: top-50 hubs week 1, top-500 week 4, full week 6 |
| `/flights-to/:iata` | ~4 000 | Same staging |
| `/routes/:from-:to` | upgrade existing ~3 500 + add Jonty's ~59 000 | In-place upgrade, sitemap re-submission |
| `/airline/:iata` | ~600 (Jonty ≥10-route filter) | Top-100 week 1, full week 4 |
| `/airline/:iata/from/:iata` | ~22 000 (Jonty ≥3-route filter) | Stage by airline tier |

**Phase 1 cannot include:** aircraft type per route (Jonty doesn't have it per-airline per-route, only carrier presence). Aircraft sections on these pages render "Aircraft data coming in {iso_week}" placeholder linking to `/by-aircraft`. **Honest gap, no fabrication.** Removed on P2 ship.

### Phase 2 — Ships after FC crawl Phase D drains (~1 week out per crawler spec)

| Family | Pages | Notes |
|---|---|---|
| Aircraft column populated on all P1 page bodies | n/a | Single bake refresh once `aircraft_routes.json` lands |
| `/aircraft/:family/routes` expansion | 14 → ~40 | Existing template, more rows |
| `/aircraft/:family/from/:iata` | ~6 000 | New family — USP cornerstone |
| `/routes/:from-:to/:aircraft` expansion | ~5 K → ~50 K | Same template, more combos |
| Route detail expansion to FC's ~200 K | up to 150 K new routes | Gate hard on "≥1 airline operating year-round" else `noindex,follow` |
| Cross-source "Data agreement" badge | site-wide | UI + JSON-LD additionalProperty |

### Phase 3 — Ships after 4–6 weeks of Search Console data

| Family | Trigger |
|---|---|
| `/flights-from/country/:iso2` | Ship if airport pages prove healthy CTR & impressions |
| `/alliance/:slug` | Ship after 4 weeks; low priority |
| Featured-snippet attack on PAA winners | Identify top-50 PAA boxes we surface in, rewrite paragraph answers to 50–60 word format |
| Programmatic IA refinements | Trim/merge any family with <100 indexed pages after 90 days |
| Possible split of route page into `/routes/:from-:to/schedule` and `/routes/:from-:to/airlines` | Only if route page exceeds 4 K words and Search Console shows topic dilution |

## 6. Risks + open questions

| Risk | Mitigation |
|---|---|
| **Duplicate content vs flightconnections.com & flightsfrom.com** — same routes, similar tables. Google may dedupe. | Win on (a) safety overlay (no incumbent has it), (b) aircraft-per-airline-per-route slice (FC has aircraft-per-route, *not* per-airline-per-route), (c) cross-source freshness badge, (d) E-E-A-T (signed author entity, methodology page, source citations). Write FAQ answers in our own voice (no template-fill that reads like a CSV dump). |
| **Lazy-bake regex desync** (FF memory `lazy-bake-regex-sync` — recurring trap, hit 3× already) | Implementation spec MUST list every new path family in `seoContentCache.isLazyPath` regex update PR alongside the builder. Acceptance criterion: hit 10 random new-family URLs, all return SSR HTML in view-source. |
| **`observed_routes.airline_iata` is ICAO** (FF memory, hit twice) | Implementation spec MUST flag: airline-page builder reads from `observed_routes`, MUST call `getAirlineByIcao`, MUST resolve to IATA for the slug. Cross-validation step before going live. |
| **Schema validator traps** (FF memory `seo-schema-validator-traps`) | No `Vehicle` for aircraft (use `Thing`). No `Country` for spatialCoverage (use `Place`). No `Offer` faked on `Flight`/`Trip`. Dataset markup needs `license`. Pre-deploy: run every page family through Google Rich Results Test on 5 sample URLs. |
| **Data freshness claims** | Per-page `dateModified` = source snapshot date. Public-facing copy says "Updated weekly from {sources}" with the actual ISO week. Never claim "real-time" or "daily" we can't back. |
| **Jonty license unresolved** (per task description) | Strategy assumes "permissive-attribution allowed". Footer + per-page footnote credits Jonty by name + repo URL. **Fallback if license restricts derivative SEO publication:** swap to OpenFlights routes (older, less complete) + FC for the aircraft USP — drops ~20 K of the long-tail routes, salvages the airport/airline/aircraft families. Implementation spec should keep data-source layer abstracted behind one interface so swap is a config flip. |
| **FC license / TOS** | Their robots.txt allows public-page crawling; consumption for our own data product is a defensible derivative-data use. We never republish their HTML verbatim, we re-derive normalized fields. Risk: if FC sends a takedown, fall back to Jonty-only (P1 surfaces remain intact, USP weakens). |
| **Crawl-budget waste** | Gating rules (§1) prevent thin-page flood. Robots-allow-no-sitemap for sub-threshold. Staged sitemap rollout (§4.3) lets Googlebot scale up gradually. |
| **Internal link explosion → equity dilution** | Cap outbound internal links per page: airport landing ≤120, route ≤30, airline ≤80, aircraft×airport ≤40. Footer "popular routes" capped at 30. |
| **Localization deferred** | Hreflang single (en); add `<link rel="alternate" hreflang="en" href="self">` and `<link rel="alternate" hreflang="x-default" href="self">` only. Country detection in copy uses English city names (e.g. "Cologne" not "Köln") — log a TODO for future i18n. |
| **AEO/GEO** | Optimize for citation: (a) every page opens with a 2-sentence factual summary (LLM-extractable), (b) every numerical claim is in a `<strong>`-wrapped sentence ("Cork airport has **8 airlines** flying to **47 non-stop destinations**"), (c) author entity with credentials linked from every page, (d) `Dataset` schema on aircraft-routes index pages with `license` and `creator`, (e) submit key pages to llms.txt (Anthropic's emerging convention). |
| **Page-template-reads-thin to humans** | Avoid pure data-dump aesthetic. Each family has a 100–200-word editorial intro generated from real signals ("Cork is Ireland's second-busiest passenger airport. From here, 8 airlines operate non-stop to 47 destinations. The longest flight is to Rhodes, 3 335 km on Ryanair's 737-800. The most-served country is the UK, with 12 destinations across 3 airlines.") — programmatic prose from facts, not LLM hallucination. |
| **Google "site reputation abuse" classification** | Programmatic pages from real data with editorial framing are safe. Pages without unique value (e.g. airline×airport with 1 route) are gated out. Avoid AI-generated filler. |

### Open questions for engineering

1. Where does the bake live? Existing `seoContentCache` infra extended, or new module per family? (Memory note implies extension, with regex sync.)
2. Cluster mode invariants (FF memory `cluster-mode-ops`): which families touch SQLite vs read-only JSON? Build under IS_LEADER guard.
3. Are sitemaps generated at bake time or by enumerator? Coupling check (FF memory `seo-bake-invariants`): builder + enumerator must stay in sync, otherwise 404s in sitemap.
4. Author entity URL — do we have `/authors/flightfinder-team` or similar? If not, ship before P1 (E-E-A-T requirement).
5. Methodology/data-sources page (`/methodology` or `/data`)? Required for E-E-A-T + AEO citation.

## 7. Metrics & validation

### Search Console KPIs (track per page family separately via URL prefix filters)

| Metric | Target by Day | Notes |
|---|---|---|
| Pages indexed in family | 60 % of submitted by Day 21 | Google's typical indexation lag for new templated content; if <40 %, content is being judged thin |
| Impressions (non-branded) | +5 K/week by Day 30, +50 K/week by Day 90 | Compare to FF baseline organic |
| CTR | ≥ 2.0 % per page family by Day 60 | Below 1 % = title/meta needs rewrite |
| Average position | top-20 for ≥30 % of family-targeted queries by Day 90 | Captured via per-family regex in Search Console |
| Featured snippet wins | ≥ 50 across all families by Day 120 | Track manually weekly |
| Rich result eligibility | 100 % of family URLs valid in Rich Results Test | Pre-deploy + ongoing audit |
| Core Web Vitals | LCP < 2.5 s mobile, INP < 200 ms, CLS < 0.1 — all green | SSR-baked content should pass trivially; risk is hydration weight |

### Milestones

| Date | Phase | Success criterion |
|---|---|---|
| Week 0 (now, 2026-05-17) | P1 ships top-50 hubs | All P1 templates live, 5 000 URLs in staged sitemap, Rich Results Test green |
| Week 4 (2026-06-14) | P1 full | 30 000 URLs submitted, ≥40 % indexed, ≥5 K weekly non-branded impressions on new families |
| Week 6 (2026-06-28) | P2 ships (FC data lands) | Aircraft USP block live on all P1 pages, `/aircraft/:family/from/:iata` first 1 000 URLs in sitemap |
| Week 12 (2026-08-09) | P2 stable | ≥50 K weekly non-branded impressions, ≥30 featured snippets, CTR ≥ 2.0 % per family |
| Week 24 (2026-10-31) | P3 decision | Per-family kill/double-down review with 90-day data; ship country/alliance if airport family proves out |

### Kill / double-down signals

| Signal | Action |
|---|---|
| Family <20 % indexed at Day 60 | Reduce inventory by tightening gating (raise route/airline thresholds), add more editorial intro, re-submit. |
| Family CTR <0.5 % at Day 60 | Rewrite title/meta templates, A/B against current. |
| Family impressions <100/week at Day 90 | Kill family, 301 to nearest sibling. |
| Family CTR >3 %, position avg <15 | Double down: expand inventory to full taxonomy, build supporting blog content for top queries. |
| Manual action / penalty | Halt all new family submissions, audit content quality, file reconsideration. |
| Aircraft × airport family outperforms route detail by 2× | Reshape internal link graph to push more equity through aircraft pages. |

## Appendix A — Spec hygiene checklist before engineering accepts

- [ ] Every page family has all 8 design elements (title / meta / H1 / above-fold / below-fold / internal links / schema / canonical+indexability) — §2 covers all 10 families.
- [ ] USP (aircraft type per airline per route) surfaces on at least one P1 family — ✓ route detail (2.3) shows aircraft per airline in table; airport pages show aircraft types column; aircraft×airport family in P2 is the cornerstone.
- [ ] Phased rollout has concrete what-ships-when — ✓ §5 tables.
- [ ] FF traps acknowledged: lazy-bake regex sync, observed_routes ICAO column, schema validator traps, cluster IS_LEADER guards, builder+enumerator coupling — ✓ §6 + open questions.
- [ ] Hreflang single (EN-only) — ✓ §2.
- [ ] No fabricated data; "data coming in week N" placeholder permitted in P1 — ✓ §5.
- [ ] License fallback documented — ✓ §6.

## Appendix B — Competitive page samples cited

- https://www.flightconnections.com/flights-from-cork-ork (airport landing archetype, ~15 K words)
- https://www.flightconnections.com/flights-from-lhr-to-jfk (route detail archetype, ~3 K words, airlines + aircraft + schedule)
- https://www.flightsfrom.com/ORK (returns 403 to bots — implies aggressive anti-scrape; their SEO snippet visible in SERP)
- https://www.flightsfrom.com/ORK/EI (airline×airport archetype — our 2.5 family directly challenges this)
- https://www.aerlingus.com/en-ie/flights-from-cork (carrier owns brand+airport — we don't try to outrank, we own the cross-airline cuts they don't)
- https://en.wikipedia.org/wiki/Heathrow_Airport (Wikipedia owns airport pages encyclopedically — we own *operational* slices, not history)
- https://simpleflying.com/united-airlines-top-boeing-787-routes/ (aircraft × route SERP is owned by blog listicles only — easy leapfrog with structured data)

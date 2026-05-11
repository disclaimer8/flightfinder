# Accident narrative pages — design

**Date:** 2026-05-11
**Scope:** V1 — NTSB + Wikidata only (verbatim, public-domain / CC0, no LLM rewrite)
**Status:** Awaiting user review before writing implementation plan
**Related:** `2026-05-09-seo-content-baking-design.md`, PR #79 (existing `/safety/events/:id` infra)

## Goal

Replace external "Source" links on `/safety/global` table with FlightFinder-hosted accident detail pages at `/accidents/{slug}`. Each page renders verbatim NTSB or Wikidata content with structured layout, JSON-LD, internal linking, and quality-gated SEO indexability. Captures search traffic that currently leaks to `aviation-safety.net` and `carol.ntsb.gov`.

V2 (later): ASN content with LLM-driven rewrite (copyright-aware), and replumbing of all FF source-link surfaces to point at internal pages.

## Non-goals

- ASN / B3A content sources (V2 — requires LLM rewrite layer)
- Cross-link rewrite on `/safety/global`, RecentSafetyEvents, aircraft/operator pages (V2, separate PR)
- Live re-fetch on user request — all content pre-fetched
- Merging sidecar `accidents` table and FF `safety_events` table

## Architecture

Two parallel ingest paths, both server-side workers on FF VPS, both `IS_LEADER`-guarded (cluster ops invariants):

```
┌──────────────────────────────────────────────────────────────────────┐
│ ntsbDumpWorker.js  —  cron 05:00 UTC daily                           │
│                                                                       │
│  1. GET https://data.ntsb.gov/avdata/up{DD}{MMM}.zip                 │
│     (or avall.zip if last_full_avall_fetched_at > 90 days ago)       │
│  2. unzip + mdb-export every table → CSV in /tmp                     │
│  3. Stream CSV, join by ev_id in-memory                              │
│  4. For each ev_id: lookup sidecar.accidents by                      │
│     source_url LIKE '%ev_id%'                                        │
│  5. UPSERT into app.db.accident_narratives                           │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ wikidataNarrativeWorker.js  —  cron 06:00 UTC weekly (Sunday)        │
│                                                                       │
│  1. SPARQL bulk → wd:Q744913 ∪ subclasses with description, P1196,   │
│     P585, P276                                                        │
│  2. For each ?event: lookup sidecar.accidents by                     │
│     source_url LIKE '%Q-id%'                                         │
│  3. UPSERT into app.db.accident_narratives                           │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ FF Node serves                                                        │
│                                                                       │
│  GET /accidents/:slug                                                 │
│   → seoMetaService renders SSR HTML for bots (lazy bake, 7d TTL)     │
│   → React AccidentDetail mounts via CSR post-init                     │
│   Both pull from accidentNarrativeService.getBySlug(slug)             │
└──────────────────────────────────────────────────────────────────────┘
```

### File layout

- `server/src/workers/ntsbDumpWorker.js` — daily cron, IS_LEADER-guarded
- `server/src/workers/wikidataNarrativeWorker.js` — weekly cron
- `server/src/services/accidentNarrativeService.js` — read API for routes + bake
- `server/src/routes/accidents.js` — Express mount `/api/accidents`
- `server/src/models/accidentNarratives.js` — DB layer (better-sqlite3)
- `server/src/utils/accidentSlug.js` — slug generation + dedup
- `server/src/services/seoContentBuilders.js` — adds `bAccident(slug)` builder
- `server/src/services/seoUrlEnumerator.js` — adds `enumerateAccidents()` for sitemap
- `client/src/pages/AccidentDetail.{jsx,css}` — UI
- `migrations/2026-05-12-add-accident-narratives.sql` — additive migration

### External dependencies

- **`mdb-tools`** (Debian apt package) on VPS — required to parse NTSB MDB files. Added to `deploy.yml` apt-install step alongside `pngquant`.
- No new npm dependencies (CSV streaming via existing `csv-parse` if present, else add).

## Database schema (FF `app.db`)

```sql
CREATE TABLE accident_narratives (
  accident_id      INTEGER PRIMARY KEY,         -- == sidecar.accidents.id (cross-DB FK by convention)
  source           TEXT NOT NULL,               -- 'ntsb' | 'wikidata'
  source_event_id  TEXT NOT NULL,               -- NTSB EventID or Wikidata Q-id
  source_url       TEXT NOT NULL,               -- canonical attribution link
  slug             TEXT NOT NULL UNIQUE,        -- '2024-10-15-fokker-50-rudufu-air-nairobi-wilson'

  narrative_text   TEXT,                        -- NTSB.narratives.IIMC / Wikidata description
  probable_cause   TEXT,                        -- NTSB.narratives.CMSGS (NULL for pending)
  factors_json     TEXT,                        -- JSON array of contributing-factor strings
  phase_of_flight  TEXT,                        -- TAKEOFF | CRUISE | APPROACH | LANDING | ...
  weather_summary  TEXT,                        -- "Day VMC, wind 270/09kt, vis 10sm"

  fetched_at       INTEGER NOT NULL,            -- unix ts of last successful fetch
  quality_score    INTEGER NOT NULL DEFAULT 0,  -- 0-100, formula below
  indexable        INTEGER NOT NULL DEFAULT 0,  -- 1 iff quality_score >= 50

  ingested_at      INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_an_slug          ON accident_narratives(slug);
CREATE INDEX idx_an_indexable     ON accident_narratives(indexable, fetched_at);
CREATE INDEX idx_an_source_event  ON accident_narratives(source, source_event_id);
```

### Quality score formula

Computed on every ingest pass:

```
score = 0
score += 30 if narrative_text and len(narrative_text) >= 300
score += 20 if probable_cause and len(probable_cause) >= 100
score += 20 if factors_json and len(parse(factors_json)) >= 1
score += 15 if weather_summary
score += 15 if phase_of_flight
indexable = (score >= 50)
```

Threshold of 50 is final. Rationale: pages with narrative + one supporting field reach 50; pure structural pages (no narrative) max out at 50 (factors + weather + phase = 50, no narrative) — borderline but acceptable as indexable since it's still unique content. Below 50: thin content, noindex.

### Migration

Pure additive. Rollback = `DROP TABLE accident_narratives`. No changes to existing tables or routes.

## Ingest pipeline

### `ntsbDumpWorker.js`

```
1. Read meta_kv.last_full_avall_fetched_at:
   - if > 90 days ago OR never → download avall.zip (94 MB, full history)
   - else → download nearest up{DD}{MMM}.zip (4 incrementals per month, ~500 KB each)
2. wget into /tmp/ntsb-{ts}/source.zip
3. unzip into /tmp/ntsb-{ts}/
4. mdb-export each required table → CSV:
     - events.csv (ev_id, ev_date, ev_city, ev_state, ev_country, latitude, longitude)
     - narratives.csv (ev_id, narr_accp, narr_cause)
     - findings.csv (ev_id, finding_description, modifier_code)
     - occurrences.csv (ev_id, occurrence_code, phase_no)
     - aircraft.csv (ev_id, acft_make, acft_model, regis_no, damage)
     - weather.csv (ev_id, wx_cond_basic, wx_temp, wind_vel_kts, wind_dir_deg, vis_sm)
5. Stream CSV → in-memory Map keyed by ev_id, joining tables.
6. For each ev_id:
   a. Lookup sidecar accident via ATTACHED database (sidecar.accidents.db opened
      read-only via `ATTACH DATABASE '/root/flightfinder/data/accidents.db' AS sc`):
        SELECT id FROM sc.accidents
          WHERE source_url LIKE '%/event/' || ev_id
             OR source_url LIKE '%/event/' || ev_id || '%'
      Path-anchored match (avoids substring false positives when one ev_id appears
      inside another URL). No match → increment meta.unmatched_ntsb_count, skip.
   b. Match → build columns (narrative_text, probable_cause, factors_json, phase_of_flight,
      weather_summary), compute quality_score, generate slug (see Slug Rules below).
   c. UPSERT into accident_narratives ON CONFLICT(accident_id) DO UPDATE SET … updated_at=now().
7. Wrap in SQLite transactions of 1000 rows; WAL checkpoint every chunk (cluster ops invariant).
8. Cleanup /tmp/ntsb-{ts}/.
9. Update meta_kv (last_ntsb_run_at, rows_ingested, rows_unmatched).
```

### `wikidataNarrativeWorker.js`

```
1. POST sparql.wikidata.org/sparql with bulk query:
     SELECT ?event ?eventLabel ?description ?date ?causeLabel ?coords
     WHERE {
       ?event wdt:P31/wdt:P279* wd:Q744913 .   -- aviation accident or subclass
       OPTIONAL { ?event schema:description ?description FILTER (LANG(?description) = "en") }
       OPTIONAL { ?event wdt:P585 ?date }
       OPTIONAL { ?event wdt:P1196 ?cause }
       ...
     }
     LIMIT 5000
2. Parse JSON response.
3. For each ?event:
   a. q_id = last URI segment.
   b. Lookup sidecar.accidents by source_url LIKE '%' || q_id || '%'.
   c. Match → UPSERT analogously (source='wikidata').
4. Log unmatched count.
```

### Backfill (one-time)

`npm run backfill-ntsb` admin CLI on first deploy. Downloads avall.zip, processes all ~30K NTSB records in one pass. Estimated runtime: ~30 minutes. After backfill, daily worker processes only incremental updates.

### Orphan cleanup

Daily job (piggy-backs on `ntsbDumpWorker.js` at end). Uses ATTACHED sidecar DB
opened read-only earlier in the same worker session:

```sql
DELETE FROM accident_narratives
WHERE NOT EXISTS (
  SELECT 1 FROM sc.accidents WHERE id = accident_narratives.accident_id
);
```

Removes narratives whose sidecar accident was deleted (rare — only on full seed regen).

## URL routing + slug rules

### Slug generation

```js
function buildAccidentSlug({ normalized_date, aircraft_model, operator, location }) {
  const parts = [];

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized_date)) {
    parts.push(normalized_date);
  } else if (/^xx (\w{3}) (\d{4})$/.test(normalized_date)) {
    const [, mon, year] = normalized_date.match(/xx (\w{3}) (\d{4})/);
    parts.push(`${year}-${MONTH_MAP[mon]}-xx`);
  } else {
    parts.push('unknown-date');
  }

  parts.push(slugify(aircraft_model, 20));
  if (operator) parts.push(slugify(operator, 20));
  if (location) parts.push(slugify(location, 25));

  let slug = parts.filter(Boolean).join('-').slice(0, 80);

  // Dedup: append -2, -3, … if slug exists for different accident_id
  let attempt = slug;
  let n = 1;
  while (await slugTaken(attempt, currentAccidentId)) {
    n++;
    attempt = `${slug.slice(0, 78 - String(n).length)}-${n}`;
  }
  return attempt;
}

function slugify(s, maxLen) {
  return s.toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
}
```

Examples:
- `2024-10-xx-fokker-50-rudufu-air-nairobi-wilson` (partial date)
- `2026-05-08-airbus-a321-271nx-frontier-airlines-denver-int` (truncated location)
- `1988-05-xx-grumman-g-159-gulfst-celanese-mexicana-within-yucatan-2` (dedup suffix)

### Express routes

`server/src/routes/accidents.js`:

```
GET  /api/accidents/:slug         → 200 JSON if quality_score >= 30
                                  → 410 Gone + Location: /safety/global if quality_score < 30
                                  → 404 if slug unknown
GET  /api/accidents/by-id/:id     → 200 JSON alternate entry by sidecar accident.id
GET  /api/accidents               → 200 JSON paginated list (indexable=1 filter)
```

Mount: `app.use('/api/accidents', require('./routes/accidents'))`.

### Client SPA route

`<Route path="/accidents/:slug" element={<AccidentDetail />} />` in `AppRoutes.jsx`.

## Page layout

```
Breadcrumb: Home → Safety → Accidents → {Date Aircraft Operator}

HERO
  <h1>{Date}: {Aircraft} {Registration} — {Operator}</h1>
  <p>{Severity badge} • {Fatalities} fatalities • {Location} • {Phase}</p>

PROBABLE CAUSE PANEL (only if probable_cause present)
  <h2>Probable cause</h2>
  <blockquote>{probable_cause verbatim}</blockquote>
  <p class="attrib">— NTSB Determination</p>

NARRATIVE
  <h2>Accident narrative</h2>
  <article>{narrative_text verbatim}</article>

FACTORS + CONDITIONS (2-column desktop, stack mobile)
  <h2>Contributing factors</h2>     <h2>Conditions</h2>
  <ul>{factors_json.map}</ul>       <dl>
                                      <dt>Phase</dt><dd>{phase}</dd>
                                      <dt>Weather</dt><dd>{weather}</dd>
                                    </dl>

RELATED EVENTS (2 axes — sidecar.accidents lacks dep_iata/arr_iata fields that
                existing fetchEventRelated relies on; airport-axis deferred to V2
                when sidecar schema gains structured route fields)
  - Same aircraft type — top 5 by sidecar.accidents.normalized_date DESC,
    matched on lowercased aircraft_model substring (since sidecar doesn't
    normalize ICAO type designators)
  - Same operator — top 5 by date, matched on exact operator string

ATTRIBUTION FOOTER
  <p>Investigation report by {NTSB | Wikidata contributors}.
     Original record: <a href="{source_url}" rel="external">{source_url}</a>.
     This page is a structured re-presentation; facts and quotes are in the public
     domain (NTSB) / CC0 (Wikidata).</p>
```

### JSON-LD Event schema

In `seoMetaService` for `/accidents/:slug` baked HTML:

```json
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "{Date}: {Aircraft} {Registration} — {Operator}",
  "startDate": "{normalized_date}",
  "location": {
    "@type": "Place",
    "name": "{location}",
    "geo": { "@type": "GeoCoordinates", "latitude": "{lat}", "longitude": "{lon}" }
  },
  "about": [
    { "@type": "Vehicle", "name": "{aircraft_model}" },
    { "@type": "Organization", "name": "{operator}" }
  ],
  "description": "{narrative_text first 250 chars}",
  "isAccessibleForFree": true,
  "publisher": { "@type": "Organization", "name": "FlightFinder" }
}
```

## SEO bake + sitemap + indexability

### Bake strategy: lazy

No pre-warm at deploy. First Googlebot request to `/accidents/{slug}` triggers `seoContentBuilders.bAccident(slug)`, result cached in `seoContentCache` with 7-day TTL. Subsequent bot or pre-mount user hits served from cache. Cold pages drop out via LRU eviction.

`bAccident(slug)` logic:

```
1. accidentNarrativeService.getBySlug(slug) → row + sidecar facts
2. If row.indexable !== 1 → return { html: 404, status: 404 }
   (Bot sees 404; React still renders for users via CSR client-fetch.)
3. Build hero + probable cause + narrative + factors + weather + related (3-axis).
4. Build JSON-LD Event schema.
5. Build canonical: <link rel="canonical" href="https://himaxym.com/accidents/{slug}">
6. Build OG tags for social shares.
```

### Sitemap inclusion

New enumeration in `seoUrlEnumerator.js`:

```js
enumerateAccidents() {
  const rows = db.prepare(`
    SELECT slug, updated_at FROM accident_narratives
    WHERE indexable = 1
    ORDER BY updated_at DESC
    LIMIT 50000
  `).all();

  return rows.map(r => ({
    loc: `${BASE}/accidents/${r.slug}`,
    lastmod: new Date(r.updated_at * 1000).toISOString().slice(0, 10),
    changefreq: 'monthly',
    priority: '0.6'
  }));
}
```

Single sitemap file `/sitemap-accidents.xml` (50K-entry cap); split into numbered files only when this is exceeded.

### Indexability tiers

| `quality_score` | `indexable` | SEO bake | Sitemap | `robots` meta | User access |
|---|---|---|---|---|---|
| ≥ 50 | 1 | YES | YES | `index,follow` | YES |
| 30-49 | 0 | NO (404 to bots) | NO | `noindex,follow` (React) | YES via CSR |
| < 30 | 0 | NO (404) | NO | `noindex,nofollow` | NO — 410 + redirect to /safety/global |

### Re-bake triggers

`seoContentCache` invalidates on:
- TTL expire (7 days)
- Manual `cache.warm()` cluster-broadcast
- `accident_narratives.updated_at` change (in-process invalidate after UPSERT)

### Admin observability

`GET /api/admin/accident-narratives-stats` (`requireAuth` + admin tier):

```json
{
  "total": 28430,
  "indexable": 11240,
  "score_distribution": { "0-29": 12100, "30-49": 5090, "50-69": 8800, "70-89": 2200, "90-100": 240 },
  "by_source": { "ntsb": 28100, "wikidata": 330 },
  "last_ntsb_run_at": "2026-05-12T05:01:18Z",
  "last_wikidata_run_at": "2026-05-10T06:00:42Z"
}
```

## Failure modes

| Scenario | Behavior | Recovery |
|---|---|---|
| `mdb-tools` missing | Worker logs ERROR, exits 1, app unaffected | One-time `apt-get install` in deploy.yml |
| NTSB 5xx / 404 on zip | Exp backoff (3 attempts), then soft-fail | Auto-retry on next cron |
| Corrupt MDB | Validate row count; if `< expected_min` skip + log | Manual `npm run backfill-ntsb` |
| SPARQL 429 / IP-block | Retry w/ jitter (60-300s), max 5 attempts | Manual retrigger next week |
| Sidecar accident.id changes | Orphan rows → daily cleanup `DELETE WHERE NOT EXISTS sidecar` | Automatic |
| Slug collision (concurrent) | UNIQUE(slug) — second INSERT fails → retry with `-2` suffix | IS_LEADER prevents race |
| Weird text encoding | NFKC normalize in slugify + narrative write | Already in slugify() |
| Narrative > 10KB | Render fully, no truncation (SQLite handles 2GB cells) | N/A |
| Empty narrative (pending) | Row created with `narrative_text=NULL`, score=0, indexable=0 | Re-ingest overwrites when available |
| Long re-ingest (>30 min) | Per-1000-row transactions + WAL checkpoint | Built-in chunking |
| Two NTSB events → one sidecar id | UNIQUE(accident_id) — second fails, log warning | Investigate root cause |

## Testing strategy

### Unit tests (no DB)

- `accidentSlug.test.js` — slugify edges: Unicode, diacritics, max-length truncation, partial-date `xx Mon YYYY`, numeric-suffix dedup.
- `qualityScore.test.js` — all 5 score components + boundaries (49, 50, 51), all-null fields.
- `ntsbParse.test.js` — given fixture CSV strings (JS-level, not real binary MDB), parses to normalized structure. (No binary MDB committed — JS-only mocks.)
- `wikidataParse.test.js` — given fixture SPARQL JSON, correct `?event` → q_id transforms.

### Integration tests (jest + SQLite `:memory:`)

- `accidentNarratives.upsert.test.js` — UPSERT idempotency.
- `ntsbDumpWorker.test.js` — mock fetch for zip + mdb-export shell-out; assert correct accidents enriched, accurate unmatched counter, no exception on empty MDB.
- `accidentsRoute.test.js` — `GET /api/accidents/:slug` → 200 with correct shape; nonexistent slug → 404; quality<30 slug → 410.

### SEO bake test

- `bAccidentBuilder.test.js` — given sample row, HTML has all expected sections, JSON-LD validates against schema, canonical URL correct.

### Post-deploy smoke

- `curl -A 'Googlebot' https://himaxym.com/accidents/{known-fatal-slug}` → grep for "Probable cause" + `<script type="application/ld+json">`.
- `curl -s https://himaxym.com/sitemap-accidents.xml | grep -c '<url>'` → non-zero.
- `GET /api/admin/accident-narratives-stats` → `indexable` between 30-50% of total.

## Rollback

All changes additive. Disable via:
- `DROP TABLE accident_narratives;` (loses data, easy to repopulate via backfill)
- Remove workers from `IS_LEADER` worker-startup block in `index.js`
- Remove route mount + sitemap enumeration call

No mutations to existing tables/routes/components in V1.

## Out of V1 scope (V2 PRs)

1. **Cross-link rewrite** — replace external `Source` columns/links on `/safety/global`, RecentSafetyEvents, `/by-aircraft/{slug}`, `/airline/{iata}` with internal `/accidents/{slug}` references where quality_score ≥ 30. Adds inbound internal links to detail pages.
2. **ASN content with LLM rewrite** — `aviation-safety.net` narratives are copyrighted; cannot be reproduced verbatim. Adds Claude/GPT API layer for paraphrase + attribution. Adds review pipeline (manual QA gate for first 500 outputs).
3. **B3A coverage** — currently skipped in `aircrash-refresh.yml` as low-quality. Re-evaluate when their format stabilizes.
4. **Event creation from NTSB dump** — V1 only enriches sidecar's existing accidents. V2 could create new sidecar rows for NTSB events that have no sidecar match.
5. **Sitemap split when accidents exceed 50K** — sitemap-accidents-1.xml / sitemap-accidents-2.xml indexed under `sitemap.xml`.

## Open questions (deferred to implementation plan)

- Should the V1 backfill CLI be runnable on the user's laptop (with rsync of output to VPS), or strictly server-side? Server-side simpler but adds 30-min deploy if run automatically.
- Cache invalidation on `accident_narratives.updated_at` — process-local Map vs cross-cluster broadcast? Probably process-local with 7d TTL is sufficient.
- `factors_json` ordering — preserve NTSB findings table order, or sort by severity/modifier? V1: preserve source order.

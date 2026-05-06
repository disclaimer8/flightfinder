# `/safety/events/{slug-id}` per-event detail pages — Design Spec

**Date:** 2026-05-06
**Owner:** Solo (denyskolomiiets)
**Status:** Approved
**Scope:** SEO Growth roadmap, Spec B (of A–D)

---

## 1. Goal

Flip the existing `/safety/events/{id}` route from `noindex` to indexable for ~300–500 high-quality events (fatal + hull-loss with sufficient context). Add unique per-event meta, slug-based URLs, Article schema, and three "Related events" blocks (same aircraft type / same operator / same airport) so each indexed page is rich enough to avoid thin-content penalties.

**Success criterion:** Google's Rich Results Test recognizes each indexable event as `Article`, the URL contains keyword-rich slug, and the visible page has ≥3 related-events links beyond the existing record grid.

---

## 2. Background

The 2026-05-06 SEO audit flagged finding **B5 — `/safety/feed` items appear flat — no detail pages** which is partially incorrect: the route `/safety/events/:id` already exists with a React component (`SafetyEventDetail.jsx`) rendering a 10-field grid + probable cause narrative. The actual problem is:

1. **noindex** is hardcoded in `seoMetaService.js` for all event URLs, with the comment: *"noindex until each event has unique narrative content — currently they're thin NTSB record dumps."*
2. **Generic title** — every event currently uses `'Aviation safety event — NTSB record | FlightFinder'`.
3. **No Article JSON-LD**.
4. **Numeric-only URLs** (`/safety/events/1234`) — no keyword in URL.
5. **No related events block** — current page is a single record dump.

This spec resolves all 5 in one batch, gated by a content-quality threshold so we don't index 5,000 thin records.

---

## 3. Architecture

**Files added:**
- `server/src/utils/eventSlug.js` — `buildEventSlug()` + `parseEventIdFromSlug()` helpers

**Files modified:**

Server:
- `server/src/services/safetyService.js` — add `getRelatedEvents(id)` + `listIndexableEvents({limit})`
- `server/src/routes/safety.js` — add `GET /api/safety/events/:id/related`
- `server/src/services/seoMetaService.js` — replace existing `safetyEventMatch` block with quality-gated, slug-aware version + Article JSON-LD
- `server/src/routes/seo.js` — sitemap enumerates indexable events (≤500)
- `server/src/index.js` (or equivalent middleware) — 301 redirect from legacy numeric URL → canonical slug URL

Client:
- `client/src/pages/safety/safetyApi.js` — add `fetchEventRelated(id)`
- `client/src/pages/safety/SafetyEventDetail.jsx` — add 3 related-events sections, fetch on mount
- `client/src/pages/safety/SafetyEventDetail.css` — `.safety-detail__related*` styles, mobile responsive

**Branch:** `feat/safety-events-detail` from main (after PR #78 merges).

---

## 4. Slug format

URL pattern: `/safety/events/{YYYY-MM-DD}-{operator-slug}-{aircraft-icao}-{airport-iata}-{id}`

Example: `/safety/events/2024-01-15-united-airlines-b789-nrt-1234`

**Builder logic** (`server/src/utils/eventSlug.js`):

```js
const slugify = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40);

function buildEventSlug(ev) {
  const date = new Date(ev.occurredAt).toISOString().slice(0, 10);
  const op   = slugify(ev.operator?.name || ev.operator?.icao) || 'unknown-op';
  const ac   = slugify(ev.aircraft?.icaoType) || 'unknown-ac';
  const ap   = slugify(ev.route?.dep || ev.location?.country) || 'unknown';
  return `${date}-${op}-${ac}-${ap}-${ev.id}`;
}

function parseEventIdFromSlug(slug) {
  const m = /-(\d+)$/.exec(String(slug || ''));
  if (m) return Number(m[1]);
  return /^\d+$/.test(slug) ? Number(slug) : null;
}

module.exports = { buildEventSlug, parseEventIdFromSlug };
```

**Backwards-compat:** parser accepts both `/safety/events/1234` (legacy numeric) and `/safety/events/2024-01-15-...-1234` (new slug-based). Server middleware issues 301 from legacy → canonical when `slug !== buildEventSlug(ev)`.

⚠️ Slug max 40 chars per segment. Total URL ≤ 120 chars — well within Google's 1000-char limit.

---

## 5. Quality gate (indexable threshold)

Per Q2, only events meeting BOTH conditions are indexable:

```js
const isHighSeverity = ev.severity === 'fatal' || ev.hullLoss === true;
const hasNarrative   = !!(ev.narrative && ev.narrative.length > 50);
const relatedCount   = svc.getRelatedEventsCount(id);
const indexable      = isHighSeverity && (hasNarrative || relatedCount >= 3);
```

Estimated coverage:
- ~5,200 total events
- ~30% fatal/hull-loss = 1,560
- ~30% of those have narrative or ≥3 related = ~470 indexable

If actual count exceeds 500, sitemap caps at 500 (most recent first); excess events still get unique meta when accessed but aren't sitemap-discovered.

---

## 6. Server: related events query

`server/src/services/safetyService.js`:

```js
function getRelatedEvents(eventId, opts = {}) {
  const { typeLimit = 5, operatorLimit = 5, airportLimit = 5 } = opts;
  const ev = getEventById(eventId);
  if (!ev) return null;

  return {
    sameAircraftType: ev.aircraft?.icaoType
      ? listEvents({ aircraft: ev.aircraft.icaoType, exclude: [eventId], limit: typeLimit })
      : [],
    sameOperator: (ev.operator?.icao || ev.operator?.iata)
      ? listEvents({
          operator: ev.operator.icao || ev.operator.iata,
          exclude: [eventId],
          limit: operatorLimit,
        })
      : [],
    sameAirport: ev.route?.dep
      ? listEvents({ airport: ev.route.dep, exclude: [eventId], limit: airportLimit })
      : [],
  };
}

function getRelatedEventsCount(eventId) {
  const r = getRelatedEvents(eventId);
  if (!r) return 0;
  return r.sameAircraftType.length + r.sameOperator.length + r.sameAirport.length;
}

function listIndexableEvents({ limit = 500 } = {}) {
  // SQL: SELECT * FROM events WHERE (severity = 'fatal' OR hullLoss = 1)
  //      AND (narrative IS NOT NULL AND length(narrative) > 50
  //           OR (SELECT COUNT(*) FROM events e2 WHERE e2.aircraft_icao = events.aircraft_icao AND e2.id != events.id) >= 3)
  //      ORDER BY occurredAt DESC LIMIT ?
  // Implementer: extend the actual query language used by listEvents to express
  // the gate. If the related-count subquery is too slow, materialize a column
  // `relatedCount` populated by an ingest-time trigger or batch update.
}
```

⚠️ Performance: the related-events query runs on every event detail page load. If `listEvents` doesn't have an `aircraft`/`operator`/`airport` filter index, add one. Page load budget: 200ms server-side for this query.

`server/src/routes/safety.js`:

```js
router.get('/events/:id/related', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const result = svc.getRelatedEvents(id);
  if (!result) return res.status(404).json({ error: 'event not found' });
  res.json(result);
});
```

---

## 7. seoMetaService update

Replace the existing `safetyEventMatch` block (lines 206–227 of current code) with:

```js
const safetyEventMatch = /^\/safety\/events\/([^/?#]+)\/?$/.exec(pathname);
if (safetyEventMatch) {
  const slug = safetyEventMatch[1];
  const id = parseEventIdFromSlug(slug);
  if (!id) return notFoundMeta();

  const ev = svc.getEventById(id);
  if (!ev) return notFoundMeta();

  const canonicalSlug = buildEventSlug(ev);
  const canonical = `${BASE}/safety/events/${canonicalSlug}`;
  const isLegacy = slug !== canonicalSlug;

  const isHighSeverity = ev.severity === 'fatal' || ev.hullLoss === true;
  const hasNarrative   = !!(ev.narrative && ev.narrative.length > 50);
  const relatedCount   = svc.getRelatedEventsCount(id);
  const indexable      = isHighSeverity && (hasNarrative || relatedCount >= 3);

  const date = new Date(ev.occurredAt).toISOString().slice(0, 10);
  const op   = ev.operator?.name || ev.operator?.icao || 'Unknown operator';
  const ac   = ev.aircraft?.icaoType || 'unknown aircraft';
  const ap   = ev.route?.dep || ev.location?.country || '';
  const sev  = ev.severity === 'fatal' ? 'Fatal' : ev.hullLoss ? 'Hull loss' : 'Incident';

  return {
    title: `${sev} accident: ${op} ${ac} at ${ap} — ${date} | FlightFinder`,
    description: `${sev} aviation accident on ${date}: ${op} operating a ${ac}${ap ? ` near ${ap}` : ''}. Aggregated from ${ev.source === 'ntsb' ? 'NTSB CAROL' : 'Aviation Safety Network / Wikidata'}.`,
    canonical,
    h1: `${sev} accident: ${op} ${ac}`,
    subtitle: `${date} · ${ap}`,
    robots: indexable ? 'index, follow' : 'noindex, follow',
    redirectFromLegacy: isLegacy ? canonical : null,
    ogType: 'article',
    kind: 'safety-event',
    eventId: id,
    eventData: ev,
  };
}
```

⚠️ The `redirectFromLegacy` field is read by middleware in `server/src/index.js` (or equivalent). When set, the middleware issues `301 → canonical` instead of serving HTML. If the existing index.js doesn't already have a redirect mechanism, add one: pre-meta-resolution step that calls `resolve(req.path)` and short-circuits with a 301 if `redirectFromLegacy` is set.

---

## 8. Article JSON-LD

In `structuredData()`, replace any existing `kind === 'safety-event'` branch (currently absent — events are noindex) with:

```js
} else if (meta.kind === 'safety-event') {
  const ev = meta.eventData;
  graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'Safety', item: `${BASE}/safety/global` },
      { '@type': 'ListItem', position: 3, name: 'NTSB feed', item: `${BASE}/safety/feed` },
      { '@type': 'ListItem', position: 4, name: meta.h1, item: meta.canonical },
    ],
  });
  graph.push({
    '@type': 'Article',
    headline: meta.title.replace(' | FlightFinder', ''),
    description: meta.description,
    url: meta.canonical,
    datePublished: ev.occurredAt,
    dateModified: ev.updatedAt || ev.occurredAt,
    author: { '@type': 'Organization', name: 'FlightFinder', url: BASE },
    publisher: {
      '@type': 'Organization',
      name: 'FlightFinder',
      url: BASE,
      logo: { '@type': 'ImageObject', url: `${BASE}/og-image.png` },
    },
    isBasedOn: ev.sourceUrl
      || (ev.source === 'ntsb'
        ? `https://www.ntsb.gov/safety/Pages/safety-overview.aspx?ev=${ev.sourceEventId}`
        : ev.sourceEventId
          ? `https://www.wikidata.org/wiki/${ev.sourceEventId}`
          : undefined),
    mainEntityOfPage: { '@type': 'WebPage', '@id': meta.canonical },
  });
}
```

---

## 9. Client: SafetyEventDetail enhancements

### 9.1 Fetch related events

Add to `safetyApi.js`:

```js
export async function fetchEventRelated(id) {
  const r = await fetch(`${API_BASE}/api/safety/events/${encodeURIComponent(id)}/related`);
  if (!r.ok) throw new Error(`fetchEventRelated ${id}: HTTP ${r.status}`);
  return r.json();
}
```

### 9.2 Render 3 related sections

In `SafetyEventDetail.jsx`, add `useState` for related + `useEffect` calling `fetchEventRelated` parallel with the existing event fetch. After the existing `<footer>` (current line 116), append:

```jsx
{related && (
  <>
    {related.sameAircraftType?.length > 0 && (
      <section className="safety-detail__related">
        <h2 className="eyebrow eyebrow--strong">
          Other events on the {event.aircraft.icaoType}
        </h2>
        <ul className="safety-detail__related-list">
          {related.sameAircraftType.map((e) => (
            <RelatedItem key={e.id} ev={e} />
          ))}
        </ul>
      </section>
    )}
    {related.sameOperator?.length > 0 && (
      <section className="safety-detail__related">
        <h2 className="eyebrow eyebrow--strong">
          Other events from {event.operator.name || event.operator.icao}
        </h2>
        <ul className="safety-detail__related-list">
          {related.sameOperator.map((e) => (<RelatedItem key={e.id} ev={e} />))}
        </ul>
      </section>
    )}
    {related.sameAirport?.length > 0 && (
      <section className="safety-detail__related">
        <h2 className="eyebrow eyebrow--strong">
          Other events near {event.route.dep}
        </h2>
        <ul className="safety-detail__related-list">
          {related.sameAirport.map((e) => (<RelatedItem key={e.id} ev={e} />))}
        </ul>
      </section>
    )}
  </>
)}
```

`RelatedItem` is a sub-component (defined in same file or extracted):

```jsx
function RelatedItem({ ev }) {
  return (
    <li>
      <Link to={`/safety/events/${ev.slug || ev.id}`}>
        <span className={`safety-badge safety-badge--${ev.severity}`}>{ev.severityLabel}</span>
        <span>{new Date(ev.occurredAt).toISOString().slice(0, 10)}</span>
        <span>{ev.operator?.name || '—'}</span>
        <span>{ev.location?.country || '—'}</span>
      </Link>
    </li>
  );
}
```

⚠️ Server should include `slug` field in related events response (built via `buildEventSlug(ev)`) so client doesn't need slug logic. Fallback to `ev.id` if slug missing.

### 9.3 CSS

Append to `SafetyEventDetail.css`:

```css
.safety-detail__related {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-light);
}

.safety-detail__related h2 {
  margin: 0 0 12px;
}

.safety-detail__related-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.safety-detail__related-list a {
  display: grid;
  grid-template-columns: 80px 90px 1fr 100px;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--text);
  text-decoration: none;
  font: 400 14px/1.4 var(--font-ui);
  transition: border-color 150ms ease, background 150ms ease;
}

.safety-detail__related-list a:hover {
  border-color: var(--text-3);
  background: var(--primary-light);
}

@media (max-width: 480px) {
  .safety-detail__related-list a {
    grid-template-columns: 70px 1fr;
    grid-template-rows: auto auto;
  }
}
```

---

## 10. Sitemap enumeration

In `seo.js`, after the route landing pages block:

```js
try {
  const safetySvc = require('../services/safetyService');
  const { buildEventSlug } = require('../utils/eventSlug');
  const indexable = safetySvc.listIndexableEvents?.({ limit: 500 }) || [];
  for (const ev of indexable) {
    urls.push({
      loc: `${BASE}/safety/events/${buildEventSlug(ev)}`,
      changefreq: 'monthly',
      priority: '0.5',
      lastmod: ev.updatedAt
        ? new Date(ev.updatedAt).toISOString().slice(0, 10)
        : new Date(ev.occurredAt).toISOString().slice(0, 10),
    });
  }
} catch (err) {
  console.warn('[seo] safety events unavailable for sitemap:', err.message);
}
```

---

## 11. Backwards-compat: legacy → canonical 301

When `seoMetaService.resolve(path)` returns `{ redirectFromLegacy: <canonical> }`, the middleware that calls `resolve()` in `server/src/index.js` should:

```js
const meta = seoMetaService.resolve(req.path);
if (meta.redirectFromLegacy) {
  return res.redirect(301, meta.redirectFromLegacy);
}
// ... continue with HTML injection ...
```

Implementer: locate the existing middleware (likely in `server/src/index.js` after route registration but before the SPA fallback) and add this check. If the file structure makes this awkward, an alternative is a dedicated express middleware mounted before the SPA fallback that handles only safety-event redirects.

---

## 12. Acceptance criteria

- [ ] `/safety/events/{slug-id}` returns unique title (e.g. `"Fatal accident: United Airlines B789 at NRT — 2024-01-15 | FlightFinder"`). Verified via `curl`.
- [ ] Article + BreadcrumbList JSON-LD emitted (verified via Google Rich Results Test post-deploy).
- [ ] Legacy numeric URL `/safety/events/1234` → 301 to canonical slug URL.
- [ ] noindex flipped to index ONLY for fatal/hull-loss events with narrative OR ≥3 related events.
- [ ] Sitemap.xml includes ≤500 quality-gated events with priority 0.5.
- [ ] Detail page renders 0–3 related-events sections (aircraft / operator / airport) — gracefully omits if no matches.
- [ ] Existing crosslinks preserved (`/safety/global?op=...`, `/aircraft/{family}`).
- [ ] Tests green; client + server builds clean; bundle under 98 KB brotli budget.
- [ ] Mobile 375 — related list stacks 2-col per CSS.

---

## 13. Out of scope

- ItemList schema on `/safety/feed` (feed index) — separate small fix.
- "X-th fatal event of operator since 1980" rankings (declined per Q1 option D).
- Related events for `/safety/global` map markers (map ≠ feed).
- Indexing of non-fatal/non-hull-loss events (gated noindex remains).
- Per-event original commentary / editorial summaries — would require human authoring; deferred to future spec.
- Search Console submission — manual ops task post-deploy.

---

## 14. Coverage map

| Audit finding | Resolution |
|---------------|------------|
| B5 (no event detail pages) | §3 (architecture); existing route + `noindex` is the bug, not absence |
| Strategic E3 (safety as content moat) | §6 (related events), §7 (rich meta), §8 (Article schema) — incremental progress |

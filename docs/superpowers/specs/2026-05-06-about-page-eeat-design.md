# /about page + E-E-A-T baseline — Design Spec

**Date:** 2026-05-06
**Owner:** Solo (denyskolomiiets)
**Status:** Approved
**Scope:** SEO Growth roadmap, Spec A (of A–D)

---

## 1. Goal

Add an `/about` page that documents what FlightFinder is, where its data comes from, how often it refreshes, and what the editorial policy is — establishing the E-E-A-T trust baseline that the SEO audit (2026-05-06) flagged as missing for a YMYL-adjacent (aviation safety) domain. Plus a "Methodology last reviewed" footer line on `/safety/global` and `/safety/feed` linking to `/about`.

**Success criterion:** every safety surface on the site can be traced back, in one click, to a documented data-source list and refresh cadence. Google's Rich Results Test recognizes the page as `AboutPage` with an `Organization` mainEntity.

---

## 2. Background

The 2026-05-06 SEO audit flagged finding **B6 — author / E-E-A-T signals weak across safety pages**. NTSB feed and global accident database cite data sources but show no methodology page, no editorial policy, no "Last reviewed" date. Quoting the audit:

> YMYL-adjacent (safety) content needs E-E-A-T signals to rank. Add a "Reviewed by [name], aviation safety analyst" byline + "Last reviewed: 2026-05-06" + link to a `/about` page describing methodology and team.

The user opted for **neutral product voice** (not founder-voice, no person disclosure) — so the E-E-A-T signal is depersonalized but still concrete: documented sources, refresh cadence, editorial integrity policy, contact email.

---

## 3. Architecture

**Files added:**
- `client/src/pages/About.jsx` — React page component
- `client/src/pages/About.module.css` — locally-scoped CSS (mirrors `legal.module.css` 720px max-width pattern)

**Files modified:**
- `client/src/App.jsx` — add `<Route path="/about" element={<About />} />`
- `client/src/components/SiteFooter.jsx` — append "About" link in Explore column
- `client/src/pages/safety/SafetyGlobal.jsx` + `.css` — add methodology note at page bottom
- `client/src/pages/safety/SafetyFeed.jsx` + `.css` — same methodology note
- `client/src/pages/legal/Attributions.jsx` — cross-link to `/about` in last paragraph
- `server/src/services/seoMetaService.js` — add `/about` resolver + AboutPage JSON-LD in `structuredData()`
- `server/src/routes/seo.js` — add `/about` to sitemap (priority 0.5, monthly)

**Branch:** `feat/about-page` from main (after PR #77 merges).

**Visual parity:** existing `/legal/*` pages establish the pattern. `/about` reuses that pattern — no new global CSS, no new design tokens. Safety pages get one new utility class (`.methodologyNote`).

---

## 4. Page content

**Hero:**
- H1: `About FlightFinder`
- Lead paragraph: one sentence summary

**Section 1 — What FlightFinder is** (~80 words)

> FlightFinder is a flight search engine built around aircraft type. Most search engines optimize for price; we optimize for the question "which plane will I actually fly on?" Routes, operators, and live schedules are filterable by manufacturer, family, and model — Boeing 737, Airbus A320, Embraer E195, ATR 72 and more. The site also publishes a global aviation safety database aggregated from public sources, kept up to date weekly.

**Section 2 — Data sources and methodology** (~150 words)

> **Schedules and fares** come from AeroDataBox, Travelpayouts, and Amadeus. Refreshed every 4 hours.
> **Observed routes** (which aircraft actually flew a given city pair) come from adsb.lol's open ADS-B network under the Open Database License. Refreshed daily.
> **Aircraft families and registrations** come from FAA, OpenFlights, and OurAirports. Refreshed quarterly.
> **Aviation safety data** combines NTSB CAROL (United States, daily), the Aviation Safety Network and B3A archives via Wikidata (worldwide, weekly).
> **Weather** comes from NOAA METAR feeds and OpenWeather.
>
> Live schedules can be incomplete or delayed — third-party APIs occasionally return partial data. We do not edit, redact, or curate accident records; we present public datasets as-is. Routes with fewer than 5 observed flights in the last 14 days do not get dedicated landing pages to avoid thin content.

**Section 3 — Open-source acknowledgments** (~80 words)

> FlightFinder is built on open-source software including React, Vite, Express, better-sqlite3, Leaflet, react-router, and many others. Per-package licenses are listed at [/legal/attributions](/legal/attributions). Aggregated public datasets are used under their respective licenses (ODbL for adsb.lol, CC0/CC-BY-SA for Wikidata, public domain for NTSB).

**Section 4 — Editorial policy** (~70 words)

> We do not edit accident records, alter fatality counts, or curate which incidents appear. Aggregated data flows from public sources (NTSB, ASN, B3A, Wikidata) directly into the FlightFinder database with deduplication by source URL. Live flight schedules are sourced from third-party APIs and may differ from what you see at booking time — always verify with your airline before travel.

**Section 5 — Contact**

> Email: [support@himaxym.com](mailto:support@himaxym.com)
> Site: [https://himaxym.com](https://himaxym.com)
> Last reviewed via `<MetaLine effective="2026-05-06" lastUpdated="2026-05-06" />` (existing component from `/legal` pages).

**Total length:** ~400 words.

---

## 5. Server-side meta + JSON-LD

In `seoMetaService.js` `resolve()` function, add a branch:

```js
if (pathname === '/about' || pathname === '/about/') {
  return {
    title: 'About FlightFinder — flight search built around aircraft type',
    description: 'FlightFinder is a flight search engine optimized for aircraft type, with a global aviation safety database aggregated from NTSB, Wikidata, B3A and ADS-B sources.',
    canonical: `${BASE}/about`,
    h1: 'About FlightFinder',
    subtitle: 'Flight search built around aircraft type, with public aviation safety data.',
    robots: 'index, follow',
    ogType: 'website',
    kind: 'about',
  };
}
```

In `structuredData()`, add `kind: 'about'` branch:

```js
} else if (meta.kind === 'about') {
  graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'About', item: meta.canonical },
    ],
  });
  graph.push({
    '@type': 'AboutPage',
    url: meta.canonical,
    name: 'About FlightFinder',
    mainEntity: {
      '@type': 'Organization',
      name: 'FlightFinder',
      url: BASE,
      description: 'Flight search engine built around aircraft type, with a global aviation safety database aggregated from public sources.',
      email: 'support@himaxym.com',
      sameAs: [BASE],
      knowsAbout: [
        'Aviation',
        'Flight schedules',
        'Aircraft types',
        'Aviation safety',
        'ADS-B',
      ],
    },
  });
}
```

---

## 6. Safety page methodology note

In `SafetyGlobal.jsx` and `SafetyFeed.jsx`, add at bottom of main content:

```jsx
<p className={styles.methodologyNote}>
  Methodology last reviewed 2026-05-06. See <Link to="/about">/about</Link> for data sources and editorial policy.
</p>
```

CSS class (in each file's `.css`):

```css
.methodologyNote {
  font: 400 13px var(--font-mono);
  color: var(--text-3);
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
}
```

Each safety page maintains its own `.methodologyNote` to keep CSS Modules' locality. Slight duplication accepted — alternative would be a global utility, but `.eyebrow`-style global utilities are reserved for genuinely cross-component shared patterns (per spec #6).

⚠️ The "Last reviewed" date is hardcoded as `2026-05-06`. Updates require a manual code change — intentional, since changes to methodology should be deliberate and tracked in git history.

---

## 7. Sitemap entry

In `seo.js` `urls` array (after `/pricing`):

```js
{ loc: `${BASE}/about`, changefreq: 'monthly', priority: '0.5', lastmod: deployDay },
```

Priority 0.5 — outranked by aircraft (0.7) and safety (0.8) since `/about` is reference content, not a primary discovery surface.

---

## 8. Internal linking

**SiteFooter.jsx** — append in "Explore" column (after existing NTSB safety feed link):

```jsx
<Link to="/about">About</Link>
```

**Attributions.jsx** — cross-link to /about in last paragraph or footer note:

```jsx
<p>Software licenses are listed above; data source attributions and refresh cadence are also documented at <Link to="/about">/about</Link>.</p>
```

This prevents `/about` from being orphaned (Google demotes pages with only sitemap discovery).

---

## 9. Acceptance criteria

- [ ] `/about` returns unique `<title>` and `<meta description>` (verify via `curl https://himaxym.com/about | grep -E "title|description"`).
- [ ] JSON-LD includes `AboutPage` + `Organization` + `BreadcrumbList` (verify via Google Rich Results Test post-deploy).
- [ ] Sitemap.xml lists `/about` with priority 0.5.
- [ ] Footer "Explore" column has working link to /about.
- [ ] `/safety/global` and `/safety/feed` have "Methodology last reviewed 2026-05-06" footer line linking to /about.
- [ ] `/legal/attributions` cross-links to /about in last paragraph.
- [ ] Visual parity preserved on desktop (no regression at 1280px screenshots).
- [ ] Tests green (1 pre-existing AuthModal flake permitted).
- [ ] Build clean, bundle under 98KB brotli budget.

---

## 10. Out of scope

- Author bylines / "Reviewed by [name]" — user opted for neutral voice (Q1=C).
- Per-section methodology callouts on safety pages (Q3=B chose footer-line only).
- Stack disclosure (Q2=C excludes "How it's built" section).
- Future blog / newsroom infrastructure — separate spec.
- Wikipedia citation outreach — strategic recommendation E3, not a code change.

---

## 11. Coverage map

| Audit finding | Resolution |
|---------------|------------|
| B6 (E-E-A-T weak on safety) | §4 (about page methodology), §6 (safety page footer note) |
| C1 (no /about page) | §3, §4, §5, §7, §8 |
| Strategic E3 (safety as content moat) | §4 Editorial policy provides foundation; full E3 strategy deferred |

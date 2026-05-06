# Site redesign — Pricing / Trips / Legal polish

**Status:** Draft
**Date:** 2026-05-06
**Owner:** Denys Kolomiiets
**Scope:** Fifth spec of the 7-part site redesign roadmap. Builds on
[Foundation](./2026-05-05-site-redesign-foundation-design.md) +
[Cross-linking](./2026-05-05-cross-linking-pass-design.md) +
[Safety redesign](./2026-05-05-safety-redesign-design.md) +
[Landing pages redesign](./2026-05-05-landing-pages-redesign-design.md)
(all merged: PRs #70, #72, #73).

---

## Context

After specs #1–#4 shipped editorial design language to homepage, safety pages,
and all landing surfaces, three smaller surfaces remain pre-spec-#1: Pricing,
MyTrips, and the three Legal pages. They render with hardcoded greys, system-sans
H1s, generic indigo CTAs, and zero design tokens.

Specifically:
- `Pricing.module.css` — `font-size: 2.5rem` H1, fallback `var(--muted, #6b7280)` greys, no Source Serif.
- `MyTrips.css` — fully hardcoded hex (`#e5e7eb`, `#6b7280`, `#fee2e2`), no tokens at all.
- `legal.module.css` — `font-size: 2rem` H1, hardcoded greys, no Source Serif.

This spec polishes those four surfaces with the editorial language already in
production. It also includes targeted Trips-card improvements (mono for flight
numbers/IATA codes/dates, severity color line for predicted delays).

## Goals

1. Source Serif headlines + Inter Tight body + IBM Plex Mono for numerical/data
   tokens (prices, dates, flight codes, IATA pairs) on Pricing, MyTrips, and Legal.
2. Demote indigo CTAs → navy fill (matches landing pages from spec #4).
3. Replace all hardcoded hex colors in MyTrips.css with design tokens.
4. PricingCard tier polish: uppercase mono eyebrow, large mono price, navy 2px
   border + RECOMMENDED ribbon for highlight tier (instead of full indigo background).
5. MyTrips trip card editorial layout: mono for flight number + IATA + dates;
   severity color line (orange/red) when predicted delay ≥ 30 / 60 min.
6. New shared `<MetaLine>` component for legal page "Effective / Last updated"
   headers; consistent across Terms / Privacy / Attributions.
7. Empty/loading/error states on MyTrips polished with Pro-feature CTA links.

## Non-goals

- Anchored TOC for Terms (9+ sections) — deferred to future polish.
- "Compare plans" expandable feature matrix on Pricing — deferred (3 tiers don't need it yet).
- Trips real-time delay alerts UI — separate feature spec.
- i18n / language switcher for legal pages.
- Pricing FAQ section.
- "Add to My Trips" button on FlightCard — out of scope.
- Stripe checkout flow / `useLifetimeStatus` / `useCheckout` — backend / hooks unchanged.

---

## §1 Architecture summary

| # | File | Change | Type |
|---|------|--------|------|
| 1.1 | `client/src/components/MetaLine.jsx` (new) | Shared component for legal page date headers | New |
| 1.2 | `client/src/components/MetaLine.css` (new) | Styles | New |
| 1.3 | `client/src/pages/Pricing.module.css` (modify) | Editorial typography + token migration | Modify |
| 1.4 | `client/src/pages/Pricing.jsx` (modify) | Add `eyebrow` field per tier; pass to PricingCard | Modify |
| 1.5 | `client/src/components/PricingCard.jsx` (modify) | New structure: eyebrow / price row / features / CTA / RECOMMENDED ribbon | Modify |
| 1.6 | `client/src/components/PricingCard.module.css` (modify) | Editorial card styles | Modify |
| 1.7 | `client/src/pages/MyTrips.jsx` (modify) | Trip card markup with mono fields; refined empty states with CTA links | Modify |
| 1.8 | `client/src/pages/MyTrips.css` (modify) | Full token migration; severity color-line classes; status block colors | Modify |
| 1.9 | `client/src/pages/legal/legal.module.css` (modify) | Editorial typography pass | Modify |
| 1.10 | `client/src/pages/legal/Terms.jsx` (modify) | Replace inline meta line with `<MetaLine>` | Modify |
| 1.11 | `client/src/pages/legal/Privacy.jsx` (modify) | Same | Modify |
| 1.12 | `client/src/pages/legal/Attributions.jsx` (modify) | Same (if Attributions has dated content) | Modify |

2 new files, 10 modified files. Single feature branch / single PR.

---

## §2 Pricing redesign

### 2.1 Pricing.module.css — replace contents

```css
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 48px 24px;
}

.hero {
  text-align: center;
  margin-bottom: 48px;
  padding-bottom: 32px;
  border-bottom: 1px solid var(--border-light);
}

.hero h1 {
  font: 600 40px/1.15 var(--font-display);
  color: var(--text);
  margin: 0 0 12px;
}

@media (max-width: 768px) {
  .hero h1 { font-size: 32px; }
}

.hero p {
  font: 400 18px/1.5 var(--font-ui);
  color: var(--text-2);
  max-width: 56ch;
  margin: 0 auto;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  align-items: stretch;
}

@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; max-width: 480px; margin: 0 auto; }
}

.error {
  background: var(--red-bg);
  color: var(--red);
  padding: 12px 16px;
  border-radius: var(--r);
  margin-bottom: 24px;
  text-align: center;
  font: 500 14px var(--font-ui);
}

.legal {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--border-light);
  text-align: center;
  font: 400 12px var(--font-ui);
  color: var(--text-3);
}

.legal a { color: var(--link); }

.nativeNotice {
  max-width: 480px;
  margin: 96px auto;
  text-align: center;
  padding: 32px;
  font: 400 16px var(--font-ui);
  color: var(--text-2);
}

.nativeNotice h2 {
  font: 600 24px/1.3 var(--font-display);
  color: var(--text);
  margin: 0 0 12px;
}
```

### 2.2 Pricing.jsx — add eyebrow per tier

The TIERS array gets an `eyebrow` field on each tier (uppercase mono label):

```jsx
const TIERS = [
  {
    tier: 'pro_monthly',
    eyebrow: 'PRO MONTHLY',
    title: 'Pro Monthly',
    price: '$4.99',
    cadence: '/month',
    features: [
      'Enriched flight card (livery, aircraft, on-time, CO₂)',
      'Delay predictions',
      'My Trips with web-push alerts',
      'Cancel anytime',
    ],
  },
  {
    tier: 'pro_annual',
    eyebrow: 'PRO ANNUAL',
    title: 'Pro Annual',
    price: '$39',
    cadence: '/year',
    features: [
      'Everything in Pro Monthly',
      'Save 35% vs monthly',
      '2 months free',
    ],
    highlight: true,
  },
  {
    tier: 'pro_lifetime',
    eyebrow: 'PRO LIFETIME',
    title: 'Pro Lifetime',
    price: '$99',
    cadence: 'once',
    features: [
      'Everything in Pro Annual',
      'Lifetime access — pay once',
      'Limited to 500 founders',
    ],
  },
];
```

The PricingCard rendering passes `eyebrow={t.eyebrow}` along with existing props.

### 2.3 PricingCard.jsx — new structure

```jsx
import styles from './PricingCard.module.css';

export function PricingCard({
  eyebrow,
  title,         // kept for accessibility / aria-label
  price,
  cadence,
  features,
  highlight = false,
  ctaLabel,
  onClick,
  disabled = false,
  note,
}) {
  return (
    <article
      className={`${styles.card}${highlight ? ' ' + styles.cardHighlight : ''}`}
      aria-label={title}
    >
      {highlight && <span className={styles.recommendedRibbon}>RECOMMENDED</span>}
      <div className={styles.eyebrow}>{eyebrow}</div>
      <div className={styles.priceRow}>
        <span className={styles.price}>{price}</span>
        <span className={styles.cadence}>{cadence}</span>
      </div>
      <ul className={styles.features}>
        {features.map(f => <li key={f}>{f}</li>)}
      </ul>
      <button
        type="button"
        className={styles.cta}
        onClick={onClick}
        disabled={disabled}
      >
        {ctaLabel}
      </button>
      {note && <p className={styles.note}>{note}</p>}
    </article>
  );
}
```

### 2.4 PricingCard.module.css — replace contents

```css
.card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 32px 24px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  position: relative;
  transition: border-color 150ms ease;
}

.cardHighlight {
  border: 2px solid var(--navy);
  padding: 31px 23px;
}

.recommendedRibbon {
  position: absolute;
  top: -10px;
  right: 16px;
  background: var(--navy);
  color: white;
  font: 500 10px var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: var(--r-sm);
}

.eyebrow {
  font: 500 11px var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}

.priceRow {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
}

.price {
  font: 600 36px var(--font-mono);
  color: var(--text);
}

.cadence {
  font: 500 14px var(--font-mono);
  color: var(--text-3);
}

.features {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.features li {
  font: 400 14px/1.5 var(--font-ui);
  color: var(--text);
  padding-left: 20px;
  position: relative;
}

.features li::before {
  content: '·';
  position: absolute;
  left: 8px;
  color: var(--text-3);
  font-weight: 700;
}

.cta {
  background: var(--navy);
  color: white;
  border: 0;
  padding: 12px 20px;
  font: 500 15px var(--font-ui);
  border-radius: var(--r);
  cursor: pointer;
  transition: background 150ms ease;
}

.cta:hover { background: var(--navy-2); }
.cta:disabled { background: var(--text-3); cursor: not-allowed; }

.note {
  font: 400 12px var(--font-mono);
  color: var(--text-3);
  margin: 0;
  text-align: center;
}
```

---

## §3 MyTrips redesign

### 3.1 MyTrips.css — replace contents

```css
.mytrips {
  max-width: 880px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

.mytrips h1 {
  font: 600 36px/1.15 var(--font-display);
  color: var(--text);
  margin: 0 0 8px;
}

.mytrips__lede {
  font: 400 16px/1.5 var(--font-ui);
  color: var(--text-2);
  margin: 0 0 32px;
  max-width: 56ch;
}

@media (max-width: 768px) {
  .mytrips h1 { font-size: 28px; }
}

.trip-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}

.trip-card {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 16px 20px;
  background: var(--card);
  transition: border-color 150ms ease, box-shadow 150ms ease;
  position: relative;
}

.trip-card:hover {
  border-color: var(--text-3);
  box-shadow: var(--shadow-sm);
}

.trip-card--delay-warn { border-left: 3px solid var(--orange); padding-left: 17px; }
.trip-card--delay-crit { border-left: 3px solid var(--red);    padding-left: 17px; }

.trip-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
}

.trip-flightnum {
  font: 600 16px var(--font-mono);
  color: var(--text);
}

.trip-route {
  font: 500 14px var(--font-mono);
  color: var(--text-2);
}

.trip-route__arrow {
  color: var(--text-3);
  padding: 0 4px;
}

.trip-when {
  font: 400 13px var(--font-mono);
  color: var(--text-2);
}

.trip-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

.trip-actions button {
  padding: 6px 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  cursor: pointer;
  font: 500 13px var(--font-ui);
  transition: background 150ms ease;
}

.trip-actions button:hover { background: var(--accent-soft); }

.trip-actions__delete:hover {
  background: var(--red-bg);
  color: var(--red);
  border-color: var(--red);
}

.trip-status {
  margin-top: 12px;
  font: 400 13px/1.5 var(--font-ui);
  color: var(--text-2);
  display: grid;
  gap: 4px;
}

.trip-live, .trip-pred, .trip-inbound {
  padding: 8px 12px;
  background: var(--accent-soft);
  border-radius: var(--r-sm);
}

.trip-live--good { background: var(--green-bg); color: var(--green); }
.trip-live--warn { background: var(--orange-bg); color: var(--orange); }
.trip-live--bad  { background: var(--red-bg);    color: var(--red); }

.mytrips-empty,
.mytrips-loading {
  text-align: center;
  padding: 64px 24px;
  font: 400 16px/1.5 var(--font-ui);
  color: var(--text-2);
}

.mytrips-empty h2 {
  font: 600 24px/1.3 var(--font-display);
  color: var(--text);
  margin: 0 0 8px;
}

.mytrips-empty__hint {
  font-size: 14px;
  color: var(--text-3);
  max-width: 48ch;
  margin: 8px auto 0;
}

.mytrips-empty__cta {
  display: inline-block;
  margin-top: 24px;
  padding: 10px 20px;
  background: var(--navy);
  color: white;
  border-radius: var(--r);
  text-decoration: none;
  font: 500 14px var(--font-ui);
  transition: background 150ms ease;
}

.mytrips-empty__cta:hover { background: var(--navy-2); }

.mytrips-error {
  padding: 16px 20px;
  background: var(--red-bg);
  color: var(--red);
  border: 1px solid var(--red);
  border-radius: var(--r);
  font: 500 14px var(--font-ui);
}
```

### 3.2 MyTrips.jsx — empty states + delay class helper

Add `delayClass()` helper at top of file:

```jsx
function delayClass(status) {
  if (!status?.predictedDelayMinutes) return '';
  const m = status.predictedDelayMinutes;
  if (m >= 60) return 'trip-card--delay-crit';
  if (m >= 30) return 'trip-card--delay-warn';
  return '';
}
```

Update no-auth empty state:

```jsx
if (!user) return (
  <div className="mytrips-empty">
    <h2>My Trips</h2>
    <p>Track upcoming flights with delay alerts and live status.</p>
    <p className="mytrips-empty__hint">My Trips is a Pro feature requiring sign-in.</p>
    <Link to="/" className="mytrips-empty__cta">Go to homepage</Link>
  </div>
);
```

Update no-trips empty state:

```jsx
if (!trips.length) return (
  <div className="mytrips-empty">
    <h2>No trips yet</h2>
    <p>Find a flight and click <strong>+ Add to My Trips</strong> to track it here.</p>
    <Link to="/" className="mytrips-empty__cta">Search flights</Link>
  </div>
);
```

Update trip-card markup (inside `trips.map`):

```jsx
<li key={t.id} className={`trip-card ${delayClass(statusById[t.id])}`}>
  <div className="trip-head">
    <div>
      <span className="trip-flightnum">{t.airlineIata}{t.flightNumber}</span>
      {' '}
      <span className="trip-route">
        · <span>{t.depIata}</span>
        <span className="trip-route__arrow">→</span>
        <span>{t.arrIata}</span>
      </span>
    </div>
    <span className="trip-when">{formatDate(t.scheduledDep)}</span>
  </div>
  <div className="trip-actions">
    <button onClick={() => loadStatus(t.id)}>Status</button>
    <button className="trip-actions__delete" onClick={() => onDelete(t.id)}>Delete</button>
  </div>
  {statusById[t.id] && (
    <div className="trip-status">
      {/* existing status content; add live class via helper if applicable */}
    </div>
  )}
</li>
```

⚠️ The actual existing field names (`airlineIata`, `flightNumber`, `depIata`,
`arrIata`, `scheduledDep`) need verification — implementer reads existing JSX
to match. If different, adapt accordingly. The goal: render mono for flight code +
IATA pair, mono date, hairline arrow separator.

The `formatDate(ms)` helper might already exist in `MyTrips.jsx` or needs
adding (similar to SafetyFeed):

```jsx
function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}
```

(Renders `YYYY-MM-DD HH:MM` — adapt format if existing flow shows different.)

### 3.3 Status block live/pred polish (optional refinement)

Inside the status rendering, add color-class for live block based on actual delay:

```jsx
const liveClass = (() => {
  const s = statusById[t.id];
  if (!s?.actualDelayMinutes && s?.actualDelayMinutes !== 0) return '';
  if (s.actualDelayMinutes >= 60) return 'trip-live--bad';
  if (s.actualDelayMinutes >= 30) return 'trip-live--warn';
  return 'trip-live--good';
})();

<div className={`trip-live ${liveClass}`}>
  {/* existing live content */}
</div>
```

Implementer matches actual API field name (might be `delayMinutes` or other).

---

## §4 Legal pages typography pass

### 4.1 New shared `<MetaLine>` component

**File:** `client/src/components/MetaLine.jsx`

```jsx
import './MetaLine.css';

export default function MetaLine({ effective, lastUpdated }) {
  return (
    <p className="meta-line">
      {effective && (
        <>
          <span className="meta-line__label">Effective</span>
          <span className="meta-line__value">{effective}</span>
        </>
      )}
      {effective && lastUpdated && <span className="meta-line__sep"> · </span>}
      {lastUpdated && (
        <>
          <span className="meta-line__label">Last updated</span>
          <span className="meta-line__value">{lastUpdated}</span>
        </>
      )}
    </p>
  );
}
```

**File:** `client/src/components/MetaLine.css`

```css
.meta-line {
  font: 400 12px var(--font-mono);
  color: var(--text-3);
  margin: 0 0 32px;
  letter-spacing: 0.02em;
}

.meta-line__label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 500;
  margin-right: 6px;
}

.meta-line__value {
  color: var(--text-2);
}

.meta-line__sep {
  color: var(--border);
  padding: 0 4px;
}
```

### 4.2 legal.module.css — replace contents

```css
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 24px 80px;
  line-height: 1.7;
}

.page h1 {
  font: 600 36px/1.15 var(--font-display);
  color: var(--text);
  margin: 0 0 12px;
}

@media (max-width: 768px) {
  .page h1 { font-size: 28px; }
}

.page h2 {
  font: 600 20px/1.3 var(--font-display);
  color: var(--text);
  margin: 40px 0 12px;
  padding-top: 24px;
  border-top: 1px solid var(--border-light);
}

.page h2:first-of-type {
  border-top: none;
  padding-top: 0;
}

.page p,
.page li {
  font: 400 16px/1.7 var(--font-ui);
  color: var(--text);
  margin: 0 0 12px;
}

.page ul {
  padding-left: 24px;
  margin-bottom: 16px;
}

.page a {
  color: var(--link);
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
  transition: text-decoration-color 150ms ease;
}

.page a:hover {
  text-decoration-color: var(--link);
}

.page strong {
  font-weight: 600;
  color: var(--text);
}

.page code {
  font: 400 14px var(--font-mono);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: 3px;
  color: var(--text);
}

.meta {
  font: 400 12px var(--font-mono);
  color: var(--text-3);
  margin-bottom: 24px;
}
```

### 4.3 Legal page JSX updates

For `Terms.jsx`, replace the inline meta paragraph:

**Before:**
```jsx
<h1>Terms of Service</h1>
<p className={styles.meta}>Effective: 2026-04-22. Last updated: 2026-04-22.</p>
```

**After:**
```jsx
import MetaLine from '../../components/MetaLine';
// …
<h1>Terms of Service</h1>
<MetaLine effective="2026-04-22" lastUpdated="2026-04-22" />
```

Same pattern for `Privacy.jsx` (existing meta date). For `Attributions.jsx` —
if it has a date, apply MetaLine; if not, skip the component on that page.

The legacy `<p className={styles.meta}>` rules in `legal.module.css` are kept as a
safety net (some legacy markup might still reference). Once all 3 legal pages
are migrated, the rule could be removed in a follow-up.

---

## §5 Roll-out, testing, follow-ups

### 5.1 Branch + commit order

Branch `feat/pricing-trips-legal-polish` from current main (after PRs
#70/#72/#73 all merged). Sequential commits:

1. `feat(common): MetaLine shared component for legal date headers`
2. `feat(pricing): editorial typography + token migration on Pricing page`
3. `feat(pricing): PricingCard mono price + uppercase eyebrow + navy CTA + RECOMMENDED ribbon`
4. `feat(trips): MyTrips token migration + Source Serif H1`
5. `feat(trips): trip card editorial layout + delay-severity color line`
6. `feat(trips): empty/loading/error state polish + CTA links`
7. `feat(legal): legal.module.css editorial typography pass`
8. `feat(legal): replace inline meta lines with <MetaLine> on Terms/Privacy/Attributions`
9. Final smoke + push + PR

Single PR → merge → GitHub Actions deploy.

### 5.2 Manual smoke

- [ ] `/pricing` desktop — Source Serif H1, 3-card grid with middle (Annual)
      highlighted via 2px navy border + RECOMMENDED ribbon, prices in Plex
      Mono, navy CTA buttons.
- [ ] `/pricing` mobile — single-column stack, max-width 480px center.
- [ ] `/pricing` clicking each tier → existing checkout flow still works
      (regression check).
- [ ] `/pricing` lifetime tier shows the "499 slots left of 500" note
      (preserved from existing flow).
- [ ] `/trips` without auth — empty state with "Go to homepage" CTA.
- [ ] `/trips` (logged in, empty) — "No trips yet" with "Search flights" CTA.
- [ ] `/trips` (logged in, with trip) — card rendering: mono flight number +
      IATA pair, mono date, severity color line when delay > 30/60min.
- [ ] Trip card delete button hover → red border + red bg.
- [ ] `/legal/terms` — Source Serif H1, MetaLine with "Effective ... · Last
      updated ..." mono badge, h2 sections with hairline rules between them.
- [ ] `/legal/privacy` — same.
- [ ] `/legal/attributions` — same (if has dates) or just MetaLine omitted.

### 5.3 Performance

Spec #4 baseline main bundle: 20.43 KB brotli. Spec #5 expected delta:
- New `<MetaLine>` component: ~0.5 KB.
- CSS additions: ~1 KB total across 3 files (Pricing.module.css,
  PricingCard.module.css, MyTrips.css, legal.module.css).
- PricingCard refactor: net 0 (replaces existing CSS).
- MyTrips.css migration: net negative (removes hex literals, adds tokens — same
  line count but cleaner).

**Budget:** home initial brotli ≤ 98 KB (97 from spec #4 + 1 KB headroom).

### 5.4 Rollback

`git revert <merge-sha>` + redeploy. Pure frontend changes, zero schema impact.
Stripe / checkout / trips API contracts unchanged.

### 5.5 Known follow-ups

| # | Issue | Future spec |
|---|-------|------|
| 1 | Anchored TOC for Terms (9+ sections) | Future polish if engagement warrants |
| 2 | Compare-plans expandable feature matrix on Pricing | Future when tier count grows |
| 3 | Trips real-time delay alerts UI (not just text) | Future feature |
| 4 | Pricing FAQ section ("Can I cancel?", "Refunds?") | Future content addition |
| 5 | i18n / language switcher for legal pages (EU customers) | Future spec |
| 6 | Compliance update workflow ("Effective date" auto-populated from git) | Future tooling |

### 5.6 Dependencies

- ✅ Specs #1–#4 — all merged. Tokens (`--font-display`, `--font-mono`,
  `--font-ui`, `--navy`, `--text-3`, `--accent-soft`, `--red-bg`, `--green-bg`,
  `--orange-bg`, etc.) all in production.
- Zero backend dependencies.
- No spec interdependency beyond token foundation.

---

## §6 Data flow

```
/pricing:
  ├─→ TIERS const (now with `eyebrow` field per tier)
  ├─→ <PricingCard> renders eyebrow + mono price + features + navy CTA
  └─→ existing useLifetimeStatus + useCheckout hooks unchanged

/trips:
  ├─→ useTrips() returns trips array (existing)
  ├─→ delayClass(status) helper picks border-class from predictedDelayMinutes
  └─→ <li className={`trip-card ${delayClass(status)}`}> renders card

/legal/<terms|privacy|attributions>:
  └─→ <MetaLine effective="..." lastUpdated="..." /> renders mono date header
```

---

## §7 Error handling

| Surface | Failure | Behavior |
|---------|---------|----------|
| Pricing tier click | Stripe checkout error | Existing `useCheckout.error` rendered in `.error` block (unchanged) |
| Trips fetch | API error | `mytrips-error` block (existing) |
| Trips delete | API error | Existing flow (no new error UI) |
| Trip status fetch | API error | `loadStatus` silently fails (existing) |
| MetaLine | Missing `effective` or `lastUpdated` props | Component renders only the present fields; if both missing, renders empty `<p>` |

---

## §8 Open questions

None blocking. Two implementation discoveries deferred to implementer:

1. **MyTrips `formatDate` helper** — verify whether already exists in `MyTrips.jsx`
   or `useTrips.js`; if not, inline the helper (`new Date(ms).toISOString().slice(0,16).replace('T',' ')`).
2. **Trip API field names** — verify actual `airlineIata` / `flightNumber` /
   `depIata` / `arrIata` / `scheduledDep` shape via `server/src/models/trips.js`
   or `useTrips.js` types. Adapt JSX field access accordingly.

---

## §9 Acceptance criteria

This spec is done when:

- [ ] `/pricing` H1 uses Source Serif 4, 40px desktop / 32px mobile.
- [ ] `/pricing` 3-tier grid renders with mono prices and uppercase mono eyebrows.
- [ ] Annual tier (highlight) has 2px navy border + RECOMMENDED ribbon
      (no full indigo background).
- [ ] All Pricing CTA buttons render navy fill (not indigo).
- [ ] `/trips` H1 uses Source Serif.
- [ ] Trip cards render mono flight code (`BA178`), mono IATA pair (`LHR → JFK`),
      mono date.
- [ ] Trip card with predicted delay ≥ 30 min shows orange left border;
      ≥ 60 min shows red.
- [ ] No-auth empty state renders Pro-feature note + "Go to homepage" CTA link.
- [ ] No-trips empty state renders "Search flights" CTA link.
- [ ] All MyTrips.css hardcoded hex colors replaced with design tokens.
- [ ] `/legal/terms`, `/legal/privacy`, `/legal/attributions` H1 uses Source Serif.
- [ ] `<MetaLine>` renders consistent date header on Terms + Privacy
      (Attributions if dated).
- [ ] All 3 legal pages render h2 sections with hairline rules between them.
- [ ] Bundle: home initial brotli ≤ 98 KB.
- [ ] Manual smoke checklist (§5.2) passes in Chrome and Safari iOS.

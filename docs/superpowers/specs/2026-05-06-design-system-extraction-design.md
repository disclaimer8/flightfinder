# Site redesign — Design system extraction

**Status:** Draft
**Date:** 2026-05-06
**Owner:** Denys Kolomiiets
**Scope:** Sixth spec of the 7-part site redesign roadmap. Builds on
specs #1–#5 (all merged: PRs #70, #72, #73, #74).

---

## Context

After 5 specs, the editorial design language is consistent across all surfaces.
However, code-level duplication has accumulated:

- **Empty-state pattern** — 4 distinct CSS classes (`landing-empty`,
  `aircraft-mix__empty`, `route-ops__empty`, `safety-feed__empty`,
  plus `mytrips-empty*` block) with near-identical styling.
- **Navy CTA button** — 9+ near-identical `background: var(--navy)` rules
  across `landing-cta`, `mytrips-empty__cta`, `PricingCard styles.cta`,
  `route-dot-popover__cta`, `empty-state__cta`.
- **Mono uppercase letterspaced eyebrow** — 15+ inline declarations
  (`route-ops__eyebrow`, `rse-eyebrow`, `sample-card-eyebrow`, `enriched-teaser__eyebrow`,
  `route-dot-popover__eyebrow`, PricingCard `styles.eyebrow`,
  AircraftIndex `styles.eyebrow`/`popularStripEyebrow`, SectionHeader
  `__eyebrow` substructure).
- **Token redundancy** — `--accent-soft` and `--primary-light` are literally
  the same hex (`#eef2ff`), introduced separately. `--navy-3` and
  `--primary-ring` may be unused.

This spec dedups patterns into shared components / utility classes and
consolidates redundant tokens, with no user-facing change.

## Goals

1. Extract `<EmptyState>` shared React component (inline + page variants),
   replace 4+ existing CSS classes.
2. Extract `<Button>` polymorphic component (renders `<button>`, `<Link>`,
   or `<a>` based on props; primary/secondary variants; sm/md sizes),
   replace ALL navy CTA rules including `PricingCard styles.cta`.
3. Add `.eyebrow` global utility class, migrate ALL eyebrow usages
   including module-scoped ones in PricingCard and AircraftIndex.
4. Add `client/src/components/index.js` barrel re-export for ergonomic
   future imports.
5. Token consolidation: delete redundant `--accent-soft` (replace usages
   with `--primary-light`); delete unused `--navy-3` and `--primary-ring`
   if grep confirms zero usage.
6. Visual parity across all surfaces (no user-facing change).

## Non-goals

- Storybook / interactive component playground.
- Standalone design system documentation file (`docs/superpowers/design-system.md`).
- Migrate all existing imports to barrel — opt-in, additive only.
- `<Card>`, `<Hero>` component abstractions — premature; wait for 4th similar pattern.
- Token renames (`--text-2` → `--text-muted`) — breaking change for
  no-benefit at this stage.
- Dark-mode tokens.

---

## §1 Architecture summary

| # | File | Change | Type |
|---|------|--------|------|
| 1.1 | `client/src/components/EmptyState.jsx` | New shared component | New |
| 1.2 | `client/src/components/EmptyState.css` | Styles | New |
| 1.3 | `client/src/components/Button.jsx` | Polymorphic button (button/Link/a) | New |
| 1.4 | `client/src/components/Button.css` | Variant + size styles | New |
| 1.5 | `client/src/components/index.js` | Barrel re-export | New |
| 1.6 | `client/src/index.css` | Add `.eyebrow` utility; consolidate `--accent-soft` → `--primary-light`; remove unused tokens if confirmed | Modify |
| 1.7 | `client/src/components/RouteOperators.jsx` + `.css` | Use EmptyState; replace eyebrow class | Modify |
| 1.8 | `client/src/components/AircraftMix.jsx` + `.css` | Use EmptyState | Modify |
| 1.9 | `client/src/components/AircraftLandingPage.jsx` + `.css` | Use EmptyState; Button replaces `.landing-cta` | Modify |
| 1.10 | `client/src/components/RecentSafetyEvents.jsx` + `.css` | Replace eyebrow class | Modify |
| 1.11 | `client/src/components/SampleCards.jsx` + `.css` | Replace eyebrow class | Modify |
| 1.12 | `client/src/components/EnrichedTeaser.jsx` + `.css` | Replace eyebrow class | Modify |
| 1.13 | `client/src/components/RouteDotPopover.jsx` + `.css` | Button replaces `.route-dot-popover__cta`; eyebrow class | Modify |
| 1.14 | `client/src/components/SectionHeader.jsx` + `.css` | Internal eyebrow uses `.eyebrow` utility | Modify |
| 1.15 | `client/src/components/PricingCard.jsx` + `.module.css` | Button replaces `styles.cta`; `.eyebrow` replaces `styles.eyebrow` | Modify |
| 1.16 | `client/src/pages/AircraftIndex.jsx` + `.module.css` | `.eyebrow` replaces module `styles.eyebrow` + `popularStripEyebrow` | Modify |
| 1.17 | `client/src/pages/safety/SafetyFeed.jsx` + `.css` | Use EmptyState | Modify |
| 1.18 | `client/src/pages/MyTrips.jsx` + `.css` | EmptyState replaces `.mytrips-empty*` blocks | Modify |
| 1.19 | All other CSS files containing `var(--accent-soft)` | Replace with `var(--primary-light)` | Modify |

5 new files, ~16 modified files. Single feature branch / single PR.

---

## §2 `<EmptyState>` shared component

### 2.1 Component definition

`client/src/components/EmptyState.jsx`:

```jsx
import { Link } from 'react-router-dom';
import './EmptyState.css';

export default function EmptyState({
  variant = 'inline',
  heading,
  children,
  cta,
}) {
  const className = `empty-state empty-state--${variant}`;
  return (
    <div className={className}>
      {heading && <h2 className="empty-state__heading">{heading}</h2>}
      {typeof children === 'string' ? (
        <p className="empty-state__body">{children}</p>
      ) : children}
      {cta && (
        cta.to ? (
          <Link to={cta.to} className="btn btn--primary btn--sm">{cta.label}</Link>
        ) : (
          <a href={cta.href} className="btn btn--primary btn--sm">{cta.label}</a>
        )
      )}
    </div>
  );
}
```

The CTA uses Button styling via global utility classes (`.btn .btn--primary .btn--sm`)
defined in `Button.css` (§3) — avoids duplicate rule.

### 2.2 Variants

- `variant="inline"` (default) — small, no extra padding, sits inside a section.
  Replaces `aircraft-mix__empty`, `route-ops__empty`, `safety-feed__empty`,
  `landing-empty`.
- `variant="page"` — large centered, full-page state. Replaces
  MyTrips `mytrips-empty*` block.

### 2.3 CSS

`client/src/components/EmptyState.css`:

```css
.empty-state {
  font: 400 14px/1.5 var(--font-ui);
  color: var(--text-3);
}

.empty-state--inline {
  padding: 16px 0;
}

.empty-state--page {
  text-align: center;
  padding: 64px 24px;
  font-size: 16px;
  color: var(--text-2);
}

.empty-state__heading {
  font: 600 24px/1.3 var(--font-display);
  color: var(--text);
  margin: 0 0 8px;
}

.empty-state--inline .empty-state__heading {
  font-size: 18px;
  margin-bottom: 4px;
}

.empty-state__body {
  margin: 0;
  max-width: 56ch;
}

.empty-state--page .empty-state__body {
  margin: 0 auto;
}

.empty-state .btn {
  margin-top: 24px;
}

.empty-state--inline .btn {
  margin-top: 12px;
}
```

Notice no own `.empty-state__cta` rule — CTA renders via `.btn` utilities.

### 2.4 Migration map (per surface)

| Surface | Before | After |
|---------|--------|-------|
| `RouteOperators.jsx` | `<p className="route-ops__empty">No carrier data observed…</p>` (inside `.route-ops` section) | `<EmptyState>No carrier data observed…</EmptyState>` |
| `AircraftMix.jsx` | `<p className="aircraft-mix__empty">No aircraft observations…</p>` | `<EmptyState>No aircraft observations…</EmptyState>` |
| `AircraftLandingPage.jsx` | `<p className="landing-empty">…</p>` (route map empty + others) | `<EmptyState>…</EmptyState>` |
| `SafetyFeed.jsx` | `<p className="safety-feed__empty">No events match this filter.</p>` | `<EmptyState>No events match this filter.</EmptyState>` |
| `MyTrips.jsx` no-auth | `<div className="mytrips-empty"><h2>My Trips</h2><p>…</p><p className="mytrips-empty__hint">…</p><Link className="mytrips-empty__cta">…</Link></div>` | `<EmptyState variant="page" heading="My Trips" cta={{ label: 'Go to homepage', to: '/' }}><p>Track upcoming flights with delay alerts and live status.</p><p className="empty-state__hint">My Trips is a Pro feature requiring sign-in.</p></EmptyState>` |
| `MyTrips.jsx` no-trips | similar block | `<EmptyState variant="page" heading="No trips yet" cta={{ label: 'Search flights', to: '/' }}>Find a flight and click <strong>+ Add to My Trips</strong> to track it here.</EmptyState>` |

For the MyTrips no-auth two-paragraph case, `children` is a ReactNode wrapping
both paragraphs. Add a `.empty-state__hint` rule for the smaller hint:

```css
.empty-state__hint {
  font-size: 14px;
  color: var(--text-3);
  max-width: 48ch;
  margin: 8px auto 0;
}
```

### 2.5 What stays specialized

- `mytrips-loading` (different role: aria-busy spinner) — keep as-is.
- `mytrips-error` (red banner, error semantics) — keep as-is.
- `AircraftLandingPage` 404-style "Aircraft not found" full-page block —
  has hero + breadcrumb + CTA, doesn't fit inline empty-state pattern.

After migration: 4 CSS classes (`route-ops__empty`, `aircraft-mix__empty`,
`safety-feed__empty`, `landing-empty`) and the `mytrips-empty*` block deleted.

---

## §3 `<Button>` polymorphic component

### 3.1 Component

`client/src/components/Button.jsx`:

```jsx
import { Link } from 'react-router-dom';
import './Button.css';

export default function Button({
  to,
  href,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}) {
  const cls = ['btn', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ');
  if (to) return <Link to={to} className={cls} {...rest}>{children}</Link>;
  if (href) return <a href={href} className={cls} {...rest}>{children}</a>;
  return <button className={cls} {...rest}>{children}</button>;
}
```

Polymorphic: `to` → `<Link>`, `href` → `<a>`, default → `<button>`. Variants:
`primary` (navy fill) and `secondary` (transparent + border). Sizes: `sm`/`md`.

`...rest` passes through `onClick`, `disabled`, `type`, `aria-*`, etc.

### 3.2 CSS

`client/src/components/Button.css`:

```css
.btn {
  display: inline-block;
  border: 0;
  font-family: var(--font-ui);
  font-weight: 500;
  border-radius: var(--r);
  cursor: pointer;
  text-decoration: none;
  transition: background 150ms ease, border-color 150ms ease;
  text-align: center;
}

.btn--md { padding: 12px 20px; font-size: 15px; }
.btn--sm { padding: 10px 20px; font-size: 14px; }

.btn--primary {
  background: var(--navy);
  color: white;
}

.btn--primary:hover {
  background: var(--navy-2);
  color: white;
}

.btn--primary:disabled {
  background: var(--text-3);
  cursor: not-allowed;
}

.btn--secondary {
  background: transparent;
  color: var(--link);
  border: 1px solid var(--border);
}

.btn--secondary:hover {
  background: var(--primary-light);
  color: var(--link);
}
```

### 3.3 Migration map

| Surface | Before | After |
|---------|--------|-------|
| `AircraftLandingPage.css` `.landing-cta` | `<Link to="..." className="landing-cta">Search flights on the {label}</Link>` | `<Button to="..." variant="primary">Search flights on the {label}</Button>`. Rule deleted. |
| `RouteDotPopover.jsx` `.route-dot-popover__cta` (primary) | `<Link to="..." className="route-dot-popover__cta">View route page →</Link>` | `<Button to="..." variant="primary">View route page →</Button>`. Rule deleted. |
| `RouteDotPopover.jsx` `.route-dot-popover__cta--secondary` | `<Link to="..." className="route-dot-popover__cta route-dot-popover__cta--secondary">Search flights →</Link>` | `<Button to="..." variant="secondary">Search flights →</Button>`. Rule deleted. |
| `PricingCard.jsx` `styles.cta` | `<button className={styles.cta} disabled={disabled} onClick={() => onSelect(tier)}>{label}</button>` | `<Button variant="primary" disabled={disabled} onClick={() => onSelect(tier)}>{label}</Button>`. Module rule deleted. |
| `EmptyState.jsx` (this spec, §2.1) | `<Link className="empty-state__cta">{cta.label}</Link>` | `<Link className="btn btn--primary btn--sm">{cta.label}</Link>` (use utility classes directly inside EmptyState since it's a presentational concern). Alternative: use `<Button to={cta.to} variant="primary" size="sm">{cta.label}</Button>` — both work. **Implementer chooses** based on import cleanliness. |

After migration: 4 button-style rules deleted. PricingCard module shrinks.

---

## §4 `.eyebrow` global utility class

### 4.1 Add to index.css

Append to `client/src/index.css`:

```css
.eyebrow {
  font: 500 11px var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.eyebrow--md { font-size: 12px; }

.eyebrow--sm {
  font-size: 10px;
  letter-spacing: 0.06em;
}

.eyebrow--strong { color: var(--text-2); }
```

### 4.2 Migration map

| Surface | Before class | After |
|---------|--------------|-------|
| `RouteOperators.jsx` | `route-ops__eyebrow` | `eyebrow eyebrow--strong` |
| `RouteOperators.jsx` | `route-ops__sub` (sub-line "Last 90 days · top N") | `eyebrow eyebrow--md` (lighter color via no `--strong`) |
| `RecentSafetyEvents.jsx` | `rse-eyebrow` | `eyebrow eyebrow--strong` |
| `SampleCards.jsx` | `sample-card-eyebrow` | `eyebrow eyebrow--strong` |
| `EnrichedTeaser.jsx` | `enriched-teaser__eyebrow` | `eyebrow eyebrow--strong` |
| `RouteDotPopover.jsx` | `route-dot-popover__eyebrow` | `eyebrow` |
| `PricingCard.jsx` | `styles.eyebrow` | `className="eyebrow eyebrow--strong"`. Module rule deleted. |
| `AircraftIndex.jsx` | `styles.eyebrow` (tile manufacturer label) | `className="eyebrow eyebrow--strong"`. Module rule deleted. |
| `AircraftIndex.jsx` | `styles.popularStripEyebrow` | `className="eyebrow"`. Module rule deleted. |
| `AircraftLandingPage.css` | `.landing-section-eyebrow` | wrapping element gets `className="eyebrow"`. Rule deleted. |
| `SectionHeader.jsx` `__eyebrow` | nested `__number / __sep / __label` substructure | refactor outer `.section-header__eyebrow` to use `.eyebrow` utility. Internal substructure rules (`__number`, `__sep`, `__label`) stay specialized. |

### 4.3 What stays specialized

- `<MetaLine>` `.meta-line__label` — has 6px right-margin layout coupling
  with the value sibling. Keep specialized.
- `<DataCard>` `.data-card__label` — labeled-row pattern. Keep specialized.
- `<SectionHeader>` `__number`, `__sep`, `__label` substructure — substructure
  rules stay; outer `__eyebrow` migrates.

After migration: ~11 of 15 inline eyebrow declarations dedup'd. 4 specialized
patterns remain (MetaLine label, DataCard label, SectionHeader internals).

---

## §5 Token consolidation pass

### 5.1 `--accent-soft` → `--primary-light` consolidation

Both literal `#eef2ff`. Spec #1 task 1 added `--accent-soft` redundantly.
Migration:

1. Search-replace `var(--accent-soft)` → `var(--primary-light)` in all CSS files:
   ```bash
   grep -rl "var(--accent-soft)" client/src/ | xargs sed -i '' 's|var(--accent-soft)|var(--primary-light)|g'
   ```
   (Verify list of changed files before applying; commit one logical chunk.)
2. Delete `--accent-soft: #eef2ff;` declaration from `client/src/index.css`.

### 5.2 Unused token cleanup

Verify usage of three candidates with grep:

```bash
grep -rE "var\(--navy-3\)" client/src/    # check if --navy-3 used
grep -rE "var\(--primary-ring\)" client/src/    # check if --primary-ring used
grep -rE "var\(--primary-dark\)" client/src/    # check if --primary-dark used outside .btn--primary:hover
```

For each that returns zero hits → delete from `:root` block.
For each that returns ≥ 1 hit → keep.

Implementer commits removal in a single chore commit with explicit list of
deleted tokens in the message.

### 5.3 What we don't touch

- `--text` / `--text-2` / `--text-3` — distinct semantic levels.
- `--bg` / `--card` / `--border` / `--border-light` — distinct.
- `--green` / `--orange` / `--red` + their `*-bg` variants — semantic colors.
- `--sev-*` — safety aliases.
- `--font-*`, `--r*`, `--shadow*`, `--z-*`, `--safe-*`, `--amber-*` — distinct.

---

## §6 Components index file

### 6.1 `client/src/components/index.js`

```js
// Shared components — re-exported for ergonomic imports.
//
// Usage:
//   import { SiteLayout, EmptyState, Button } from '../components';
//
// Page-specific or single-use components are NOT re-exported (they live in
// their own paths and are imported directly to keep this barrel focused).

export { default as SiteLayout }        from './SiteLayout';
export { default as SiteHeader }        from './SiteHeader';
export { default as SiteFooter }        from './SiteFooter';
export { default as SectionHeader }     from './SectionHeader';
export { default as DataCard }          from './DataCard';
export { default as AircraftMix }       from './AircraftMix';
export { default as RouteOperators }    from './RouteOperators';
export { default as RouteDotPopover }   from './RouteDotPopover';
export { default as EnrichedTeaser }    from './EnrichedTeaser';
export { default as RecentSafetyEvents } from './RecentSafetyEvents';
export { default as SampleCards }       from './SampleCards';
export { default as MetaLine }          from './MetaLine';
export { default as EmptyState }        from './EmptyState';
export { default as Button }            from './Button';
export { PricingCard }                  from './PricingCard';
```

### 6.2 Migration policy

**No existing imports rewritten.** Existing `import SiteLayout from './components/SiteLayout';` continues to work. The barrel adds an optional second import style for new code without breaking existing.

---

## §7 Roll-out, testing, follow-ups

### 7.1 Branch + commit order (~13 commits)

Branch `feat/design-system-extraction` from current main:

1. `feat(common): EmptyState shared component (inline + page variants)`
2. `feat(common): Button polymorphic component (button/Link/a, variants, sizes)`
3. `chore(tokens): add .eyebrow utility class to index.css`
4. `refactor(landing): EmptyState replaces 4 sibling empty classes`
5. `refactor(landing): Button replaces .landing-cta and .route-dot-popover__cta`
6. `refactor(pricing): Button replaces PricingCard styles.cta`
7. `refactor(landing): .eyebrow utility replaces sample-card / route-ops / rse / enriched-teaser eyebrows`
8. `refactor(pricing): .eyebrow utility replaces PricingCard styles.eyebrow`
9. `refactor(aircraft-index): .eyebrow utility replaces module styles.eyebrow + popularStripEyebrow`
10. `refactor(landing): SectionHeader internal eyebrow uses .eyebrow utility`
11. `chore(tokens): consolidate --accent-soft → --primary-light, remove unused tokens`
12. `feat(common): components/index.js barrel re-export`
13. Final smoke + push + PR

Single PR / single deploy.

### 7.2 Manual smoke

Visual parity is the success criterion. Walk through every surface and verify
no regressions:

- [ ] `/` (homepage) — sample card hover, "Browse all aircraft" link, header navy bg, footer 3-col layout — unchanged
- [ ] `/aircraft/boeing-787` — Source Serif H1, DataCard sidebar, "View routes" CTA navy, eyebrow `BOEING` mono uppercase
- [ ] `/aircraft/cessna-172` (no JSON) — fallback content + map empty state via EmptyState
- [ ] `/routes/lhr-jfk` — RouteOperators table, AircraftMix, hero stat strip — unchanged
- [ ] `/routes/zzz-yyy` (no observations) — EmptyState renders inline in operators + aircraft sections
- [ ] `/safety/global` — eyebrow on filter section, table header — unchanged
- [ ] `/safety/feed` — eyebrow on filter pills group — unchanged
- [ ] `/safety/feed` empty filter result — EmptyState ("No events match this filter.")
- [ ] `/by-aircraft` — tile manufacturer eyebrow renders mono; MOST FLOWN rail eyebrow renders
- [ ] `/pricing` — tier eyebrow `PRO MONTHLY/ANNUAL/LIFETIME` renders, CTA navy clickable, checkout flow regression check
- [ ] `/trips` (no auth) — EmptyState page variant with "Go to homepage" CTA
- [ ] `/trips` (no trips) — EmptyState page variant with "Search flights" CTA
- [ ] `/legal/terms` — MetaLine eyebrow renders unchanged

### 7.3 Performance

Spec #5 baseline main bundle: 20.49 KB brotli. Spec #6 expected delta:

- New `<EmptyState>` + `<Button>` components: ~1 KB combined gzipped.
- 4 utility CSS rules added to index.css: ~0.3 KB.
- Removed duplicate rules across 8+ CSS files: ~2-3 KB net negative.
- Net: **slight reduction** (-1 KB brotli expected).

**Budget**: home initial brotli ≤ 98 KB (no change from spec #5).

### 7.4 Test impact

- PricingCard tests use `.cta` selector or `getByLabelText`. After Button
  replaces `styles.cta`, tests using class-name selectors need adapt.
  Implementer adapts inline (e.g. `getByRole('button', { name: /subscribe/i })`).
- New EmptyState component gets minimal smoke test (renders heading +
  body + optional CTA based on variant).
- New Button component gets minimal smoke test (renders 3 element types
  based on `to`/`href`/default; applies variant class).

### 7.5 Rollback

`git revert <merge-sha>` + redeploy. All changes are CSS/JSX refactors,
zero schema/API changes. Visual parity is the success criterion — if
regression spotted, full revert is safe.

### 7.6 Known follow-ups

| # | Issue | Future spec |
|---|-------|------|
| 1 | Migrate all existing imports to use barrel | Future polish if onboarding new contributors |
| 2 | `<Card>` shared component (tile pattern across SampleCards / AircraftIndex / DataCard sidebar) | Future if 4th similar pattern appears |
| 3 | `<Hero>` shared component (existing landing/pricing/legal heroes have same H1+sub structure) | Future if value proven |
| 4 | Storybook / interactive playground page | Future when contributor count > 1 |
| 5 | Token rename pass (e.g. `--text-2` → `--text-muted`) | Future breaking-change spec |
| 6 | Dark-mode tokens | Future spec |

### 7.7 Dependencies

- ✅ All specs #1–#5 merged. PRs #70, #72, #73, #74.
- All design tokens in `client/src/index.css` from spec #1.
- No backend changes.

---

## §8 Acceptance criteria

This spec is done when:

- [ ] `<EmptyState>` component exists and is used on RouteOperators, AircraftMix, AircraftLandingPage, SafetyFeed, MyTrips (5 surfaces).
- [ ] Old empty-state CSS classes (`route-ops__empty`, `aircraft-mix__empty`, `safety-feed__empty`, `landing-empty`, `mytrips-empty*`) are deleted from their CSS files.
- [ ] `<Button>` component exists and is used on AircraftLandingPage, RouteDotPopover (2 variants), PricingCard, EmptyState (4 surfaces).
- [ ] Old button CSS rules (`landing-cta`, `route-dot-popover__cta`, PricingCard `styles.cta`) are deleted.
- [ ] `.eyebrow` utility class exists in `index.css`.
- [ ] Eyebrow class migrations applied: RouteOperators, RecentSafetyEvents, SampleCards, EnrichedTeaser, RouteDotPopover, PricingCard, AircraftIndex (≥ 7 surfaces).
- [ ] `--accent-soft` token deleted from `index.css`; all usages migrated to `--primary-light`.
- [ ] At least one of `--navy-3` / `--primary-ring` token deleted (or both kept with rationale documented in commit message).
- [ ] `client/src/components/index.js` barrel re-export file exists with all listed component re-exports.
- [ ] Visual parity: manual smoke checklist (§7.2) passes — no surface looks different from before.
- [ ] Bundle: home initial brotli ≤ 98 KB (or lower).
- [ ] All client tests pass (1 pre-existing AuthModal flake from earlier specs allowed).

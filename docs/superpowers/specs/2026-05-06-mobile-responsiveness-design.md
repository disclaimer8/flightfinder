# Mobile Responsiveness Audit — Design Spec

**Date:** 2026-05-06
**Owner:** Solo (denyskolomiiets)
**Status:** Approved
**Scope:** Spec #7 of the redesign roadmap — final spec

---

## 1. Goal

Make `himaxym.com` consistently usable across mobile, tablet, and desktop viewports through a token-driven responsive system, fix three known mobile bugs surfaced by Playwright audit @ 375×812, and align hot-zone touch targets with WCAG 2.5.5 guidance.

**Success criterion:** all 8 audited surfaces render cleanly at 375px / 768px / 1280px without overflow, truncation, or sub-44px primary CTAs. Existing desktop appearance preserved (visual parity at 1280px).

---

## 2. Audit findings (baseline)

Empirical Playwright audit @ 375×812 covered: home, search, aircraft landing, route landing, pricing, my-trips, safety/global, safety/feed, by-aircraft, mobile nav drawer, sign-in modal.

### Surfaces working well
- Home (hero / sample cards / footer)
- Search form (mobile bottom-sheet renders, fields readable)
- Pricing (3 cards stack 1-up, RECOMMENDED ribbon clean)
- My Trips empty page (EmptyState page-variant from spec #6)
- Safety global (header / callout / leaflet map / table)
- Safety feed (filter pills + event cards)
- Mobile nav drawer (hamburger overlay, large touch targets)

### Bugs
1. **AircraftRouteMap header overflow** at 375px — back arrow + "Obse…" + refresh + "Lis…" + "2 origins" tooltip all crammed into the top bar; controls truncated.
2. **AircraftIndex filter tabs cutoff** — `All / Wide-body / Narrow-body / Regio…` — last tab cut off; tabs neither scroll horizontally nor stack.
3. **AuthModal CTA colour drift** — "Sign in" button renders indigo (`#6366f1`, legacy `--primary`) instead of navy (`#0a1628`, the post-redesign canonical CTA color). This is a missed migration from the demoted-indigo decision in earlier specs.

### System drift
- **12 distinct breakpoints** used in `@media` queries: 480 (×4), 500 (×1), 560 (×1), 600 (×8), 640 (×9), 700 (×1), 720 (×1), 768 (×10), 900 (×3), 1024 (×2). No tokens. Drift invisible without grep.
- **Hot-zone touch targets** below 44×44 in places: form inputs (~40px), AircraftIndex tabs (~32px), filter pills on Safety Feed (~32px).
- **Hero H1 overflow** on narrow viewports (`The aircraft- and safety-aware flight search engine`, `Boeing 787 Dreamliner flights and routes`) — fixed sizes don't scale.

---

## 3. Architecture overview

Three token files + targeted bug fixes + hot-zone touch-target bumps + breakpoint round-down across the codebase.

**Branch:** `feat/mobile-responsiveness` from `main` after PR #75 (spec #6) merges.

**Files added:**
- `client/src/styles/breakpoints.css` (3 breakpoint tokens)
- `client/src/styles/typography.css` (clamp-based fluid H1/H2/H3 scale)

**Files modified:** `index.css` (import the new files, safe-area additions, global form input padding), `Button.css` (touch target padding bump), ~25 component CSS files (breakpoint round-down + typography migration), `AircraftRouteMap.css/jsx`, `AircraftIndex.module.css`, `AuthModal.jsx/css`, `SiteHeader.css`, `SiteFooter.css`, `client/index.html` (viewport-fit=cover verification).

**Visual parity criterion:** desktop screenshots (≥ 1280px viewport) must match pre-spec-#7 state on all 8 audited surfaces. Mobile/tablet screenshots may differ — that's the point.

---

## 4. Breakpoint tokens

**File: `client/src/styles/breakpoints.css`**

```css
:root {
  --bp-sm: 480px;   /* small phone boundary */
  --bp-md: 768px;   /* tablet portrait boundary */
  --bp-lg: 1024px;  /* tablet landscape / desktop boundary */
}
```

⚠️ **Implementation note:** custom properties are not supported inside `@media (max-width: ...)` per CSS spec. Tokens serve as documentation and JS reference; media queries use raw values.

**Migration rules (strict round-down):**
- 480, 500 → `480px` (annotate `/* sm */`)
- 560, 600, 640, 700, 720 → `768px` (annotate `/* md */`)
- 900, 1024 → `1024px` (annotate `/* lg */`)

**Affected:** ~25 `@media` rules across 12+ component CSS files.

**Trade-off accepted:** breakpoint thresholds shift by 40–200px on some surfaces. Visual delta in real layouts is negligible because responsive rules adapt gradually around the threshold. If a specific surface breaks at the new threshold, fix it inline (don't reintroduce a custom value).

---

## 5. Fluid typography (clamp-based)

**File: `client/src/styles/typography.css`**

```css
:root {
  /* Display headings (Source Serif 4) — fluid scale */
  --font-h1: clamp(28px, 4.5vw + 12px, 48px);   /* hero / page title */
  --font-h2: clamp(22px, 3vw + 12px, 36px);     /* section heading */
  --font-h3: clamp(18px, 2vw + 10px, 24px);     /* card heading */

  /* Body sizes */
  --font-body: clamp(15px, 0.5vw + 14px, 16px); /* main copy */
  --font-meta: 14px;                            /* card meta, small print (no scale) */
}
```

**Visual targets** (computed at common widths):

| Token | 320px | 375px | 768px | 1280px |
|-------|-------|-------|-------|--------|
| --font-h1 | 28px | 28px | 41px | 48px |
| --font-h2 | 22px | 22px | 34px | 36px |
| --font-h3 | 18px | 18px | 23px | 24px |
| --font-body | 15px | 15px | 16px | 16px |

**Migrations:**
- `client/src/index.css` — global `h1, h2, h3` rules use the new tokens.
- `client/src/pages/legal/legal.module.css` `.page h1` (currently `36px` + `@media 768px → 28px`) → `var(--font-h1)`. Drop the @media override.
- `client/src/components/AircraftLandingPage.css` hero H1 (currently `48px` + `@media 768px → 32px`) → `var(--font-h1)`. Drop override.
- `client/src/components/RouteLandingPage.css` hero H1 — same migration.
- `client/src/pages/Pricing.module.css` "Choose your plan" → `var(--font-h1)`.
- `client/src/components/EmptyState.css` `.empty-state__heading` — `font-size: var(--font-h3)` for inline variant (page variant keeps current heading via clamp through token).

**Excluded:**
- `SectionHeader.__label` and other mono eyebrows — these are 11–14px utilitarian labels, not display headings. Untouched.
- Body `<p>` rules — main copy is 15–16px and `clamp()` would yield only 1px scale delta. YAGNI.

**Result:** ~6 surfaces lose their per-breakpoint typography overrides. Cleaner CSS, zero visual regression on intermediate widths.

---

## 6. Bug fixes

### 6.1 AircraftRouteMap header overflow

**File: `client/src/components/AircraftRouteMap.css`** (+ minor JSX cleanup if controls aren't already in a wrapper)

```css
.aircraft-route-map__header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
}

@media (max-width: 480px) {  /* sm */
  .aircraft-route-map__header {
    flex-direction: column;
    align-items: stretch;
  }
  .aircraft-route-map__title {
    text-align: center;
    font-size: 13px;
  }
  .aircraft-route-map__controls {
    justify-content: center;
  }
}
```

JSX: ensure back/refresh/list buttons are wrapped in `.aircraft-route-map__controls` flex row. If structure already exists, only CSS changes.

### 6.2 AircraftIndex filter tabs cutoff

**File: `client/src/pages/AircraftIndex.module.css`**

```css
.tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.tabs::-webkit-scrollbar { display: none; }

@media (max-width: 480px) {  /* sm */
  .tabs {
    padding-bottom: 8px;
  }
  .tab {
    flex-shrink: 0;
    font-size: 13px;
    padding: 12px 16px;  /* also satisfies touch target — see §7 */
  }
}
```

Horizontal scroll lets all tabs remain accessible at any width. Desktop unchanged.

### 6.3 AuthModal CTA — indigo → navy via Spec #6 `<Button>`

**File: `client/src/components/AuthModal.jsx`**

```jsx
import Button from './Button';
// ...
<Button type="submit" variant="primary" disabled={loading}>
  {loading
    ? 'Signing in…'
    : (mode === 'signin' ? 'Sign in' : 'Create account')}
</Button>
```

**File: `client/src/components/AuthModal.css`** — delete `.submit-btn`, `.submit-btn:hover`, `.submit-btn:disabled` rules. Same migration applies to any other indigo `<button>` inside AuthModal — audit and migrate all to `<Button>`.

This also means the `submit-btn` CSS class disappears from the file entirely; no orphan declarations.

---

## 7. Touch-target bumps (hot zones)

**Standard:** primary CTAs / form inputs / nav tabs / pricing buttons ≥ 44×44. Inline text links in paragraphs and footer not enforced (would balloon layout).

**Changes:**

1. **`<Button>` (`Button.css`)** — bump `.btn--md` padding from `12px 20px` → `13px 20px` (height = 13+15+13+leading ≈ 44px). Bump `.btn--sm` padding from `10px 20px` → `12px 20px` (height ≈ 42px — acceptable for compact contexts).

2. **Form inputs (`index.css` global rule)** — bump `input, select, textarea` padding from `10px 12px` → `12px 12px` (height ≈ 44px).

3. **AircraftIndex tabs (`AircraftIndex.module.css`)** — covered by §6.2 above (`12px 16px` padding).

4. **Mobile menu items (`SiteHeader.css`)** — verify each item ≥ 44px tall in hamburger drawer; bump padding if shorter. Currently 14–16px text + 12–16px padding ≈ 40–44px borderline.

5. **Pricing card `Subscribe` button** — already `<Button variant="primary">` from spec #6, inherits bump #1. ✓

6. **Pagination buttons (Safety table)** — verify ≥ 44px; bump if shorter.

7. **Filter pills on Safety Feed** — bump from `8px 14px` → `10px 16px` (height ≈ 38px). Sub-44px accepted: this is a filter row, not a primary CTA. Documented compromise.

---

## 8. Safe-area insets (iOS)

### 8.1 Viewport meta

**File: `client/index.html`** — verify `viewport-fit=cover` is present:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

Without `viewport-fit=cover` the `env(safe-area-inset-*)` values return `0` even on iPhone X+. Add if missing.

### 8.2 Footer

**File: `client/src/components/SiteFooter.css`**

```css
.site-footer {
  padding-bottom: max(24px, env(safe-area-inset-bottom));
}
```

`max()` keeps 24px minimum on devices without notch + correct clearance for iPhone home indicator.

### 8.3 Sticky / transparent SiteHeader

**File: `client/src/components/SiteHeader.css`**

```css
.site-header {
  padding-top: max(0px, env(safe-area-inset-top));
}

.site-header.is-transparent {
  /* notch background protection — gradient extends past safe-area */
  padding-top: max(12px, env(safe-area-inset-top));
}
```

Affects iOS Safari standalone PWA mode + landscape Safari without bottom bar. Standard browser chrome already handles safe-area, but the transparent-over-hero variant on home page renders under the notch without the inset.

### 8.4 Out of scope

- Modal dialogs (AuthModal, RouteDotPopover) — center-positioned overlays, safe-area win is minimal.
- Search-form mobile bottom-sheet — spot-check during implementation; if it covers edge-to-edge bottom, add `padding-bottom: env(...)` to its submit button container. Not bundled into this spec.

---

## 9. Migration order + roll-out

1. **Tokens first** — create `breakpoints.css`, `typography.css`, import into `index.css`. Visual: zero change.
2. **Bug fixes (§6.1–6.3)** — three targeted fixes. Visual: bugs resolved, rest unchanged.
3. **Touch target bumps (§7)** — padding adjustments. Visual: minor +2-4px height on primary CTAs (positive UX).
4. **Typography migration (§5)** — replace inline H1/H2 rules and `@media` typography overrides with `var(--font-h*)`. Drop the `@media` override blocks. Visual: clamp scale active across all viewports.
5. **Breakpoint round-down (§4)** — sweep `@media` rules across all CSS files, round to 480/768/1024, annotate with comments. Visual: thresholds shift 40–200px (negligible in gradual responsive layouts).
6. **Safe-area (§8)** — viewport meta + footer/header padding rules. Visual: iPhone X+ users see correct home indicator clearance.
7. **Final visual smoke** — Playwright screenshots @ 375 / 768 / 1280 on all 8 audit surfaces. Side-by-side compare against pre-spec-#7 baseline.

---

## 10. Test strategy

- **Unit tests:** existing client suite remains green. Touch-target padding bumps may shift layout-snapshot tests — adapt selectors/expectations if breaks (semantic over class-name preferred).
- **Visual smoke:** Playwright screenshots @ 3 viewports × 8 surfaces = 24 images. Manual diff vs pre-merge baseline. Tracked in PR description.
- **Manual device test (recommended):** open `himaxym.com` on iPhone Safari (or Chrome dev tools "iPhone 12 Pro" preset) — verify safe-area actually clears the home indicator, hamburger drawer feels good, tabs scroll smoothly.
- **Tests for new components:** none — new files are token files (`breakpoints.css`, `typography.css`), not components. No assertions needed.

---

## 11. Acceptance criteria

- [ ] 3 token files exist (`breakpoints.css`, `typography.css`, plus safe-area additions in `index.css`); all imported once.
- [ ] ≤ 3 distinct `max-width` values in `@media` queries across `client/src/`: 480px, 768px, 1024px. (verify via grep)
- [ ] AircraftRouteMap header does not overflow at 375px viewport; controls accessible.
- [ ] AircraftIndex tabs scroll horizontally, last tab visible at 375px.
- [ ] AuthModal "Sign in" / "Create account" CTAs render navy (`--navy`), not indigo.
- [ ] Hero H1 on home / aircraft-landing / pricing ≤ 32px on 375px viewport.
- [ ] Form inputs / `Button.btn--md` / pricing CTAs ≥ 44px height.
- [ ] Footer respects iPhone home indicator (visual verify on iOS device or simulator).
- [ ] Visual parity preserved on desktop (no regression in 1280px screenshots vs baseline).
- [ ] Test suite remains green (1 pre-existing AuthModal flake permitted).
- [ ] Build succeeds, bundle remains under 98 KB brotli budget for main chunk.

---

## 12. Out of scope (parking lot)

- Container queries (`@container`) — modern primitive; defer to future spec.
- Dark mode tokens.
- RTL support.
- Print stylesheets.
- Modal dialog safe-area insets.
- iPhone PWA standalone manifest tweaks (no PWA setup).
- Touch-target bumps for inline text links and footer links (would balloon layout).
- Tablet-specific adaptations (default to desktop layout for ≥ 768px is fine).

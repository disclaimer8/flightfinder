# Pricing, Legal & Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public `/pricing` page, checkout flow, legal pages (ToS + Privacy), Capacitor gate, Sentry tagging, and flip `STRIPE_LIVE=1` — the launch wiring that turns Plans 01–04 into a product users can actually buy.

**Architecture:** A `/pricing` React route renders three tier cards and polls `GET /api/subscriptions/lifetime-status` for the live Lifetime slot counter. Each card's CTA posts to `/api/subscriptions/checkout` (built in Plan 01) and redirects to the Stripe-hosted URL. On return, `?subscribe=success|cancel` query params show a banner and refresh `/auth/me` to pick up the new tier. Inside the Capacitor native shell, pricing routes are hidden and any "Upgrade" CTA opens the web URL in an external browser (Apple 3.1.1 sidestep). Static legal pages live under `/legal/terms` and `/legal/privacy`. Sentry gets per-route transaction tags (`subscriptions`, `trips`, `enriched`, `pricing`). `STRIPE_LIVE=0→1` is a manual deploy step with a documented smoke checklist.

**Tech Stack:** React Router, existing `AuthContext`, Stripe Checkout (hosted), Capacitor `@capacitor/core`, Sentry React SDK (already in project), Vitest for client tests.

---

## File Structure

**Client (new):**
- `client/src/pages/Pricing.jsx` — 3 tier cards + lifetime counter
- `client/src/pages/SubscribeReturn.jsx` — handles `?subscribe=success|cancel`
- `client/src/pages/legal/Terms.jsx` — ToS (static markdown-ish JSX)
- `client/src/pages/legal/Privacy.jsx` — Privacy Policy
- `client/src/hooks/useLifetimeStatus.js` — polls counter every 30s
- `client/src/hooks/useCheckout.js` — POSTs checkout + redirect
- `client/src/utils/platform.js` — `isNativeApp()` wrapper around Capacitor detection
- `client/src/components/PricingCard.jsx` — reusable tier card
- `client/src/__tests__/Pricing.test.jsx`
- `client/src/__tests__/SubscribeReturn.test.jsx`
- `client/src/__tests__/platform.test.js`

**Client (modify):**
- `client/src/App.jsx` — add 4 routes (`/pricing`, `/subscribe/return`, `/legal/terms`, `/legal/privacy`); gate `/pricing` behind `isNativeApp()`
- `client/src/components/Header.jsx` — add "Pricing" nav link (hidden on native)
- `client/src/main.jsx` — Sentry route-level tagging (if not already)
- `client/index.html` — remove any final affiliate-booking language in meta/OG
- `client/src/services/seoMetaService.js` — strip residual affiliate copy

**Server (modify):**
- `server/src/index.js` — Sentry transaction tags on request handler
- `.github/workflows/deploy.yml` — document `STRIPE_LIVE=1` flip

**Docs (new):**
- `docs/launch/smoke-checklist.md` — manual QA steps before flipping STRIPE_LIVE
- `docs/launch/announcement-draft.md` — marketing copy template

---

## Task 1: Platform detection helper

**Files:**
- Create: `client/src/utils/platform.js`
- Test: `client/src/__tests__/platform.test.js`

- [ ] **Step 1: Write failing test**

```js
// client/src/__tests__/platform.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('platform utils', () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.Capacitor;
  });

  it('returns false when Capacitor is not present', async () => {
    const { isNativeApp } = await import('../utils/platform.js');
    expect(isNativeApp()).toBe(false);
  });

  it('returns true when Capacitor.isNativePlatform() is true', async () => {
    window.Capacitor = { isNativePlatform: () => true };
    const { isNativeApp } = await import('../utils/platform.js');
    expect(isNativeApp()).toBe(true);
  });

  it('returns false when Capacitor.isNativePlatform() is false (web build of Capacitor)', async () => {
    window.Capacitor = { isNativePlatform: () => false };
    const { isNativeApp } = await import('../utils/platform.js');
    expect(isNativeApp()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/__tests__/platform.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement platform helper**

```js
// client/src/utils/platform.js
export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function') return false;
  return cap.isNativePlatform();
}

export async function openExternal(url) {
  if (isNativeApp() && window.Capacitor?.Plugins?.Browser?.open) {
    await window.Capacitor.Plugins.Browser.open({ url });
    return;
  }
  window.location.href = url;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/__tests__/platform.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/platform.js client/src/__tests__/platform.test.js
git commit -m "feat(client): add platform detection helper for Capacitor gate"
```

---

## Task 2: useLifetimeStatus hook

**Files:**
- Create: `client/src/hooks/useLifetimeStatus.js`
- Test: `client/src/__tests__/useLifetimeStatus.test.jsx`

- [ ] **Step 1: Write failing test**

```jsx
// client/src/__tests__/useLifetimeStatus.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLifetimeStatus } from '../hooks/useLifetimeStatus.js';

describe('useLifetimeStatus', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cap: 500, taken: 37, remaining: 463, soldOut: false }),
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('fetches lifetime-status on mount', async () => {
    const { result } = renderHook(() => useLifetimeStatus());
    await waitFor(() => expect(result.current.status).toBeTruthy());
    expect(result.current.status.taken).toBe(37);
    expect(result.current.status.soldOut).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith('/api/subscriptions/lifetime-status', expect.any(Object));
  });

  it('exposes error when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { result } = renderHook(() => useLifetimeStatus());
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd client && npx vitest run src/__tests__/useLifetimeStatus.test.jsx`

- [ ] **Step 3: Implement hook**

```js
// client/src/hooks/useLifetimeStatus.js
import { useEffect, useState, useRef } from 'react';

const POLL_MS = 30_000;

export function useLifetimeStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer;

    async function fetchOnce() {
      try {
        const res = await fetch('/api/subscriptions/lifetime-status', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted.current) setStatus(data);
      } catch (err) {
        if (mounted.current) setError(err);
      } finally {
        if (mounted.current) timer = setTimeout(fetchOnce, POLL_MS);
      }
    }

    fetchOnce();
    return () => {
      mounted.current = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { status, error };
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useLifetimeStatus.js client/src/__tests__/useLifetimeStatus.test.jsx
git commit -m "feat(client): useLifetimeStatus hook with 30s polling"
```

---

## Task 3: useCheckout hook

**Files:**
- Create: `client/src/hooks/useCheckout.js`
- Test: `client/src/__tests__/useCheckout.test.jsx`

- [ ] **Step 1: Write failing test**

```jsx
// client/src/__tests__/useCheckout.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCheckout } from '../hooks/useCheckout.js';

describe('useCheckout', () => {
  beforeEach(() => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({ href: '', origin: 'https://himaxym.com' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }),
    });
  });

  it('posts to /api/subscriptions/checkout with tier', async () => {
    const { result } = renderHook(() => useCheckout());
    await act(async () => { await result.current.start('pro_monthly'); });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/subscriptions/checkout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tier: 'pro_monthly' }),
      })
    );
  });

  it('sets error when server returns SOLD_OUT', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ error: 'SOLD_OUT', message: 'Lifetime sold out' }),
    });
    const { result } = renderHook(() => useCheckout());
    await act(async () => { await result.current.start('pro_lifetime'); });
    expect(result.current.error).toMatch(/sold out/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement hook**

```js
// client/src/hooks/useCheckout.js
import { useState, useCallback } from 'react';

export function useCheckout() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const start = useCallback(async (tier) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/subscriptions/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'SOLD_OUT') throw new Error('Lifetime sold out — try Pro Monthly or Annual');
        if (data.error === 'PAYWALL' || res.status === 401) {
          window.location.href = '/login?next=/pricing';
          return;
        }
        throw new Error(data.message || `Checkout failed (${res.status})`);
      }
      if (!data.url) throw new Error('Checkout URL missing');
      window.location.href = data.url;
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { start, loading, error };
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useCheckout.js client/src/__tests__/useCheckout.test.jsx
git commit -m "feat(client): useCheckout hook that POSTs and redirects to Stripe"
```

---

## Task 4: PricingCard component

**Files:**
- Create: `client/src/components/PricingCard.jsx`
- Create: `client/src/components/PricingCard.module.css`
- Test: `client/src/__tests__/PricingCard.test.jsx`

- [ ] **Step 1: Write failing test**

```jsx
// client/src/__tests__/PricingCard.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PricingCard } from '../components/PricingCard.jsx';

describe('PricingCard', () => {
  const base = {
    tier: 'pro_monthly',
    title: 'Pro Monthly',
    price: '$4.99',
    cadence: '/month',
    features: ['Enriched card', 'Delay predictions', 'My Trips'],
    onSelect: () => {},
  };

  it('renders price, title, features', () => {
    render(<PricingCard {...base} />);
    expect(screen.getByText('Pro Monthly')).toBeInTheDocument();
    expect(screen.getByText('$4.99')).toBeInTheDocument();
    expect(screen.getByText('Enriched card')).toBeInTheDocument();
  });

  it('fires onSelect with tier when CTA clicked', () => {
    const onSelect = vi.fn();
    render(<PricingCard {...base} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }));
    expect(onSelect).toHaveBeenCalledWith('pro_monthly');
  });

  it('shows sold-out badge and disables CTA when soldOut=true', () => {
    render(<PricingCard {...base} tier="pro_lifetime" soldOut />);
    expect(screen.getByText(/sold out/i)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows remaining counter when remaining is provided', () => {
    render(<PricingCard {...base} tier="pro_lifetime" remaining={42} />);
    expect(screen.getByText(/42 slots left/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement component**

```jsx
// client/src/components/PricingCard.jsx
import styles from './PricingCard.module.css';

export function PricingCard({
  tier, title, price, cadence,
  features, onSelect, highlight = false,
  remaining = null, soldOut = false,
  loading = false,
}) {
  const disabled = soldOut || loading;
  return (
    <div className={`${styles.card} ${highlight ? styles.highlight : ''}`}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.priceRow}>
        <span className={styles.price}>{price}</span>
        {cadence && <span className={styles.cadence}>{cadence}</span>}
      </div>
      {tier === 'pro_lifetime' && remaining != null && !soldOut && (
        <div className={styles.counter}>{remaining} slots left of 500</div>
      )}
      {soldOut && <div className={styles.soldOut}>Sold out</div>}
      <ul className={styles.features}>
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.cta}
        disabled={disabled}
        onClick={() => onSelect(tier)}
      >
        {loading ? 'Redirecting…' : soldOut ? 'Sold out' : 'Subscribe'}
      </button>
    </div>
  );
}
```

```css
/* client/src/components/PricingCard.module.css */
.card {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 280px;
  max-width: 360px;
}
.highlight {
  border-color: var(--accent, #3b82f6);
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.15);
}
.title { margin: 0; font-size: 1.25rem; font-weight: 600; }
.priceRow { display: flex; align-items: baseline; gap: 4px; }
.price { font-size: 2rem; font-weight: 700; }
.cadence { color: var(--muted, #6b7280); }
.counter { color: var(--accent, #3b82f6); font-size: 0.875rem; font-weight: 500; }
.soldOut { color: #b91c1c; font-weight: 600; }
.features { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.features li::before { content: "✓ "; color: var(--accent, #3b82f6); font-weight: 700; }
.cta {
  background: var(--accent, #3b82f6); color: #fff; border: 0; padding: 12px 16px;
  border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 1rem;
}
.cta:disabled { background: #9ca3af; cursor: not-allowed; }
```

- [ ] **Step 4: Run test — expect PASS (4 tests)**

- [ ] **Step 5: Commit**

```bash
git add client/src/components/PricingCard.jsx client/src/components/PricingCard.module.css client/src/__tests__/PricingCard.test.jsx
git commit -m "feat(client): PricingCard component with sold-out + remaining states"
```

---

## Task 5: Pricing page

**Files:**
- Create: `client/src/pages/Pricing.jsx`
- Create: `client/src/pages/Pricing.module.css`
- Test: `client/src/__tests__/Pricing.test.jsx`

- [ ] **Step 1: Write failing test**

```jsx
// client/src/__tests__/Pricing.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Pricing from '../pages/Pricing.jsx';

vi.mock('../utils/platform.js', () => ({ isNativeApp: () => false }));

describe('Pricing page', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('lifetime-status')) {
        return Promise.resolve({ ok: true, json: async () => ({ cap: 500, taken: 37, remaining: 463, soldOut: false }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }) });
    });
    delete window.location;
    window.location = { href: '', origin: 'https://himaxym.com' };
  });

  it('renders all three tiers', async () => {
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    expect(await screen.findByText(/Pro Monthly/)).toBeInTheDocument();
    expect(screen.getByText(/Pro Annual/)).toBeInTheDocument();
    expect(screen.getByText(/Pro Lifetime/)).toBeInTheDocument();
  });

  it('shows lifetime slots remaining once counter loads', async () => {
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/463 slots left/i)).toBeInTheDocument());
  });

  it('triggers checkout when a tier CTA is clicked', async () => {
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    await waitFor(() => screen.getByText(/463 slots left/i));
    const buttons = screen.getAllByRole('button', { name: /subscribe/i });
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/subscriptions/checkout',
        expect.objectContaining({ method: 'POST' })
      )
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement Pricing page**

```jsx
// client/src/pages/Pricing.jsx
import { Link } from 'react-router-dom';
import { PricingCard } from '../components/PricingCard.jsx';
import { useLifetimeStatus } from '../hooks/useLifetimeStatus.js';
import { useCheckout } from '../hooks/useCheckout.js';
import { isNativeApp } from '../utils/platform.js';
import styles from './Pricing.module.css';

const TIERS = [
  {
    tier: 'pro_monthly',
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

export default function Pricing() {
  const { status } = useLifetimeStatus();
  const { start, loading, error } = useCheckout();

  if (isNativeApp()) {
    return (
      <div className={styles.nativeNotice}>
        <h2>Manage subscription on the web</h2>
        <p>Pricing and checkout are available at <a href="https://himaxym.com/pricing">himaxym.com/pricing</a>.</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1>Choose your plan</h1>
        <p>Unlock enriched flight data, delay predictions, and My Trips.</p>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <div className={styles.grid}>
        {TIERS.map((t) => (
          <PricingCard
            key={t.tier}
            {...t}
            remaining={t.tier === 'pro_lifetime' ? status?.remaining : null}
            soldOut={t.tier === 'pro_lifetime' ? !!status?.soldOut : false}
            loading={loading}
            onSelect={start}
          />
        ))}
      </div>

      <footer className={styles.legal}>
        <p>
          Subscriptions auto-renew. Cancel anytime via the billing portal.
          Lifetime is capped at 500 slots and, per EU rules, the 14-day right of
          withdrawal is waived once you gain access.{' '}
          <Link to="/legal/terms">Terms</Link> · <Link to="/legal/privacy">Privacy</Link>
        </p>
        <p>Payments processed by Stripe. Taxes calculated automatically.</p>
      </footer>
    </div>
  );
}
```

```css
/* client/src/pages/Pricing.module.css */
.page { max-width: 1100px; margin: 0 auto; padding: 48px 16px; }
.hero { text-align: center; margin-bottom: 32px; }
.hero h1 { font-size: 2.5rem; margin: 0 0 8px; }
.hero p { color: var(--muted, #6b7280); margin: 0; }
.grid { display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; }
.error { background: #fee2e2; color: #991b1b; padding: 12px 16px; border-radius: 8px; margin-bottom: 24px; text-align: center; }
.legal { margin-top: 48px; text-align: center; color: var(--muted, #6b7280); font-size: 0.875rem; }
.legal a { color: inherit; text-decoration: underline; }
.nativeNotice { max-width: 480px; margin: 96px auto; text-align: center; padding: 32px; }
```

- [ ] **Step 4: Run test — expect PASS (3 tests)**

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Pricing.jsx client/src/pages/Pricing.module.css client/src/__tests__/Pricing.test.jsx
git commit -m "feat(client): pricing page with 3 tiers + live lifetime counter"
```

---

## Task 6: Subscribe return page

**Files:**
- Create: `client/src/pages/SubscribeReturn.jsx`
- Test: `client/src/__tests__/SubscribeReturn.test.jsx`

- [ ] **Step 1: Write failing test**

```jsx
// client/src/__tests__/SubscribeReturn.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SubscribeReturn from '../pages/SubscribeReturn.jsx';

const refreshUser = vi.fn();
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ refreshUser }),
}));

describe('SubscribeReturn', () => {
  beforeEach(() => { refreshUser.mockReset(); });

  it('shows success state and refreshes user when ?subscribe=success', async () => {
    render(
      <MemoryRouter initialEntries={['/subscribe/return?subscribe=success']}>
        <SubscribeReturn />
      </MemoryRouter>
    );
    expect(await screen.findByText(/welcome to pro/i)).toBeInTheDocument();
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
  });

  it('shows cancel state when ?subscribe=cancel', () => {
    render(
      <MemoryRouter initialEntries={['/subscribe/return?subscribe=cancel']}>
        <SubscribeReturn />
      </MemoryRouter>
    );
    expect(screen.getByText(/checkout cancelled/i)).toBeInTheDocument();
    expect(refreshUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement SubscribeReturn**

```jsx
// client/src/pages/SubscribeReturn.jsx
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function SubscribeReturn() {
  const [params] = useSearchParams();
  const outcome = params.get('subscribe');
  const { refreshUser } = useAuth();

  useEffect(() => {
    if (outcome === 'success' && typeof refreshUser === 'function') {
      refreshUser();
    }
  }, [outcome, refreshUser]);

  if (outcome === 'success') {
    return (
      <div style={{ textAlign: 'center', padding: '96px 16px', maxWidth: 560, margin: '0 auto' }}>
        <h1>Welcome to Pro ✈️</h1>
        <p>Your subscription is active. Enriched card, delay predictions, and My Trips are now unlocked.</p>
        <p><Link to="/">Start searching flights →</Link></p>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '96px 16px', maxWidth: 560, margin: '0 auto' }}>
      <h1>Checkout cancelled</h1>
      <p>No charges were made. You can pick a plan anytime.</p>
      <p><Link to="/pricing">Back to pricing</Link></p>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/SubscribeReturn.jsx client/src/__tests__/SubscribeReturn.test.jsx
git commit -m "feat(client): subscribe return page for Stripe success/cancel"
```

---

## Task 7: Legal pages (Terms + Privacy)

**Files:**
- Create: `client/src/pages/legal/Terms.jsx`
- Create: `client/src/pages/legal/Privacy.jsx`
- Create: `client/src/pages/legal/legal.module.css`

- [ ] **Step 1: Write Terms of Service**

```jsx
// client/src/pages/legal/Terms.jsx
import styles from './legal.module.css';

export default function Terms() {
  return (
    <article className={styles.page}>
      <h1>Terms of Service</h1>
      <p className={styles.meta}>Effective: 2026-04-22. Last updated: 2026-04-22.</p>

      <h2>1. Who we are</h2>
      <p>
        himaxym.com ("the Service") is operated by the site owner reachable at
        <a href="mailto:support@himaxym.com"> support@himaxym.com</a>.
      </p>

      <h2>2. Account and access</h2>
      <p>You must provide a valid email and keep credentials secure. You may delete your account at any time.</p>

      <h2>3. Subscriptions</h2>
      <ul>
        <li><strong>Pro Monthly ($4.99/month)</strong> — auto-renews every month until cancelled.</li>
        <li><strong>Pro Annual ($39/year)</strong> — auto-renews every 12 months until cancelled.</li>
        <li><strong>Pro Lifetime ($99 one-time)</strong> — one-time payment for continued access while the Service operates. Limited to 500 total purchases.</li>
      </ul>

      <h2>4. Billing and taxes</h2>
      <p>
        Payments are processed by Stripe, Inc. Taxes are calculated automatically at checkout based on your
        location. We do not store card numbers.
      </p>

      <h2>5. Refunds and cancellation</h2>
      <p>
        You may cancel monthly or annual subscriptions at any time via the billing portal; access continues until
        the end of the paid period. Refunds on recurring charges are granted within 7 days of the most recent
        renewal at our discretion.
      </p>
      <p>
        <strong>EU right of withdrawal (14 days):</strong> where the 2011/83/EU Consumer Rights Directive applies,
        you have 14 days to withdraw from a purchase. By starting to use the Pro features immediately after
        payment, you expressly consent to waive this right for the Lifetime plan; for Monthly and Annual plans,
        withdrawal within 14 days entitles you to a prorated refund for unused time.
      </p>

      <h2>6. Service availability</h2>
      <p>
        Flight data is provided best-effort from third-party sources (AeroDataBox, adsb.lol, Travelpayouts, OpenWeather)
        and may be incomplete or delayed. We do not guarantee accuracy. Do not use this Service as the sole source
        of truth for flight booking or operational decisions.
      </p>

      <h2>7. Acceptable use</h2>
      <p>No scraping, automated bulk queries, resale of data, or reverse-engineering.</p>

      <h2>8. Termination</h2>
      <p>
        We may suspend or terminate accounts that violate these Terms. On termination we will refund any unused
        portion of a Monthly or Annual subscription. Lifetime buyers who are terminated for fraud or abuse are not
        entitled to a refund.
      </p>

      <h2>9. Changes</h2>
      <p>We may update these Terms with 30 days notice by email for material changes.</p>

      <h2>10. Governing law</h2>
      <p>These Terms are governed by the laws applicable at the operator's registered residence, without regard to conflict-of-laws rules.</p>
    </article>
  );
}
```

- [ ] **Step 2: Write Privacy Policy**

```jsx
// client/src/pages/legal/Privacy.jsx
import styles from './legal.module.css';

export default function Privacy() {
  return (
    <article className={styles.page}>
      <h1>Privacy Policy</h1>
      <p className={styles.meta}>Effective: 2026-04-22.</p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account:</strong> email address, hashed password, verification status.</li>
        <li><strong>Subscription:</strong> Stripe customer ID, subscription ID, tier, validity dates. We never see your card number.</li>
        <li><strong>Trips (My Trips):</strong> flight numbers, dates, routes you choose to save.</li>
        <li><strong>Push subscriptions:</strong> endpoint URL and encryption keys supplied by your browser's Push service.</li>
        <li><strong>Usage telemetry:</strong> anonymised request logs, error reports via Sentry (EU region).</li>
      </ul>

      <h2>2. Data we share</h2>
      <ul>
        <li><strong>Stripe</strong> — to process payments and manage subscriptions.</li>
        <li><strong>Mailgun</strong> — to send transactional email (verification, receipts, alerts).</li>
        <li><strong>Sentry</strong> — to diagnose errors.</li>
        <li><strong>Browser push services</strong> (e.g. Google FCM, Mozilla autopush) — to deliver notifications you opted into.</li>
      </ul>
      <p>We do not sell data to third parties or run advertising trackers.</p>

      <h2>3. Cookies</h2>
      <p>
        We use one session cookie for authentication and a Stripe checkout cookie during checkout. No marketing
        or analytics cookies.
      </p>

      <h2>4. Data retention</h2>
      <ul>
        <li>Account + subscription records: kept while your account exists; deleted within 30 days of account deletion.</li>
        <li>Trips: deleted with your account or on request.</li>
        <li>Push endpoints: deleted when unsubscribed by your browser or by you.</li>
        <li>Error logs: retained 90 days in Sentry.</li>
      </ul>

      <h2>5. Your rights (GDPR / UK GDPR)</h2>
      <p>
        You may request access, correction, export, or deletion of your data by emailing
        <a href="mailto:support@himaxym.com"> support@himaxym.com</a>. We respond within 30 days.
      </p>

      <h2>6. Data location</h2>
      <p>Hosting is in the EU (Hetzner). Stripe and Sentry operate in the EU region.</p>

      <h2>7. Children</h2>
      <p>The Service is not directed at users under 16.</p>

      <h2>8. Changes</h2>
      <p>We will notify registered users by email for material changes.</p>
    </article>
  );
}
```

- [ ] **Step 3: Write shared stylesheet**

```css
/* client/src/pages/legal/legal.module.css */
.page {
  max-width: 760px;
  margin: 0 auto;
  padding: 48px 16px;
  line-height: 1.7;
}
.page h1 { font-size: 2rem; }
.page h2 { margin-top: 32px; font-size: 1.25rem; }
.page ul { padding-left: 24px; }
.meta { color: var(--muted, #6b7280); font-size: 0.875rem; }
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/legal/
git commit -m "feat(client): Terms of Service and Privacy Policy pages"
```

---

## Task 8: Wire routes + native gate in App.jsx

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/Header.jsx` (if a Pricing nav link is desired)

- [ ] **Step 1: Read current App.jsx routing block**

Run: `grep -n "Route" client/src/App.jsx | head -40`

- [ ] **Step 2: Add imports + 4 routes**

Add near the top of `App.jsx`:

```jsx
import { lazy, Suspense } from 'react';
import { isNativeApp } from './utils/platform.js';

const Pricing = lazy(() => import('./pages/Pricing.jsx'));
const SubscribeReturn = lazy(() => import('./pages/SubscribeReturn.jsx'));
const Terms = lazy(() => import('./pages/legal/Terms.jsx'));
const Privacy = lazy(() => import('./pages/legal/Privacy.jsx'));
```

Inside the `<Routes>` block (web-only routes — legal pages are shown everywhere, pricing+return are web-only):

```jsx
{!isNativeApp() && (
  <>
    <Route path="/pricing" element={<Suspense fallback={null}><Pricing /></Suspense>} />
    <Route path="/subscribe/return" element={<Suspense fallback={null}><SubscribeReturn /></Suspense>} />
  </>
)}
<Route path="/legal/terms" element={<Suspense fallback={null}><Terms /></Suspense>} />
<Route path="/legal/privacy" element={<Suspense fallback={null}><Privacy /></Suspense>} />
```

- [ ] **Step 3: Add Pricing nav link in Header (web only)**

In `client/src/components/Header.jsx`, wherever the nav links live, add (conditionally):

```jsx
{!isNativeApp() && (
  <Link to="/pricing" className="nav-link">Pricing</Link>
)}
```

with `import { isNativeApp } from '../utils/platform.js'` at the top.

- [ ] **Step 4: Smoke-check the routing**

Run: `cd client && npm run build`
Expected: PASS (no import errors)

Run: `cd client && npm run dev &` and visit:
- http://localhost:5173/pricing → renders 3 cards
- http://localhost:5173/legal/terms → renders ToS
- http://localhost:5173/legal/privacy → renders Privacy

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.jsx client/src/components/Header.jsx
git commit -m "feat(client): wire pricing, return, and legal routes with Capacitor gate"
```

---

## Task 9: Strip residual affiliate copy from SEO + HTML

**Files:**
- Modify: `client/index.html`
- Modify: `client/src/services/seoMetaService.js`

- [ ] **Step 1: Identify affiliate-booking strings**

Run: `grep -rni -E 'book (your )?flights?|aviasales|affiliate|commission|cashback' client/index.html client/src/services/seoMetaService.js`

- [ ] **Step 2: Replace with subscription-oriented copy**

In `client/index.html` — update `<meta name="description">`, `<meta property="og:description">`, `<meta name="twitter:description">` to:

```
Enriched flight data, delay predictions, and trip alerts. Pro from $4.99/month.
```

Update `<meta property="og:title">` and `<title>` if they reference booking — replace with: `himaxym — enriched flight search`.

In `client/src/services/seoMetaService.js` — grep for any template literal mentioning "book" / "aviasales" and replace the user-facing portion. Keep the per-route title logic; only change the prose.

- [ ] **Step 3: Verify**

Run: `grep -rni -E 'book (your )?flights?|aviasales|affiliate|commission|cashback' client/index.html client/src/services/seoMetaService.js`
Expected: no results (or only in unrelated context — inspect each hit)

- [ ] **Step 4: Build check**

Run: `cd client && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/src/services/seoMetaService.js
git commit -m "chore(seo): remove residual affiliate copy, reposition for subscription"
```

---

## Task 10: Sentry per-route transaction tagging (server)

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Find the Sentry request handler wiring**

Run: `grep -n "Sentry" server/src/index.js`

Confirm Sentry is already initialised and `Sentry.Handlers.requestHandler()` (or `Sentry.expressIntegration()` in v8+) is mounted.

- [ ] **Step 2: Add route-based tag middleware**

After the Sentry request handler is mounted and before routes are mounted, insert:

```js
app.use((req, res, next) => {
  if (!req.path) return next();
  let tag = 'other';
  if (req.path.startsWith('/api/subscriptions')) tag = 'subscriptions';
  else if (req.path.startsWith('/api/trips') || req.path.startsWith('/api/push')) tag = 'trips';
  else if (req.path.match(/^\/api\/flights\/[^/]+\/enriched/)) tag = 'enriched';
  else if (req.path.startsWith('/api/flights')) tag = 'flights';
  else if (req.path.startsWith('/api/map') || req.path.startsWith('/api/aircraft')) tag = 'map';
  else if (req.path.startsWith('/api/auth')) tag = 'auth';

  try {
    const scope = require('@sentry/node').getCurrentScope?.();
    if (scope) scope.setTag('route_group', tag);
  } catch {}
  next();
});
```

- [ ] **Step 3: Smoke test**

Run the server locally, hit `/api/flights/explore?departure=LHR`, then check Sentry transactions (if sampled) that `route_group: flights` tag is set. If Sentry is disabled locally, this is a visual-only check in prod — note this step as manual.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.js
git commit -m "chore(sentry): tag transactions by route group"
```

---

## Task 11: Launch smoke-checklist doc

**Files:**
- Create: `docs/launch/smoke-checklist.md`

- [ ] **Step 1: Write the checklist**

```markdown
# Pre-launch smoke checklist (himaxym.com subscription pivot)

Run this ENTIRE list on staging (or against `STRIPE_LIVE=0` test-mode on prod) before flipping `STRIPE_LIVE=1`.

## Environment variables (prod)

Verify in Hetzner `.env` / PM2 env / GitHub Actions secrets:

- [ ] `STRIPE_SECRET_KEY` — test key while `STRIPE_LIVE=0`, live key before flip
- [ ] `STRIPE_WEBHOOK_SECRET` — from Stripe dashboard webhook endpoint
- [ ] `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_PRICE_LIFETIME`
- [ ] `STRIPE_LIVE=0` (will be flipped last)
- [ ] `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT`
- [ ] `AERODATABOX_KEY` / `RAPIDAPI_KEY`
- [ ] `OPENWEATHER_KEY`
- [ ] `INGEST_ENABLED=1`, `TRIPS_ENABLED=1`, `ENRICHED_CARD=1`

## Database migrations

- [ ] SSH is forbidden — verify via the deploy log that idempotent migrations ran without error on PM2 start
- [ ] `GET /api/subscriptions/lifetime-status` returns `{cap:500, taken:0, remaining:500, soldOut:false}`

## End-to-end subscription flow (Stripe test mode)

- [ ] Create test account → `/auth/me` shows `subscription_tier: "free"`
- [ ] Visit `/pricing` → 3 cards render, lifetime shows "500 slots left"
- [ ] Click Pro Monthly → redirected to Stripe checkout → pay with `4242 4242 4242 4242`
- [ ] Redirected to `/subscribe/return?subscribe=success` → "Welcome to Pro" shown
- [ ] `/auth/me` now returns `subscription_tier: "pro_monthly"`, `sub_valid_until` set
- [ ] `GET /api/flights/X:YYYY-MM-DD/enriched` returns full fields (not teaser)
- [ ] Repeat for Pro Annual
- [ ] Repeat for Pro Lifetime → `lifetime-status.taken` incremented by 1
- [ ] Cancel subscription via billing portal → webhook updates tier to `free` at period end

## Webhook resilience

- [ ] Stripe dashboard → resend a previous `checkout.session.completed` event → server returns 200 but DB state unchanged (dedup via `webhook_events`)
- [ ] Invalid signature → 400 rejection

## Lifetime sold-out handling

- [ ] Manually UPDATE `lifetime_counter SET taken = 500` → `/pricing` shows "Sold out" disabled button → checkout POST returns 409 SOLD_OUT

## Paywall

- [ ] As `free` user, `GET /api/flights/X:YYYY-MM-DD/enriched` → 403 PAYWALL
- [ ] As `free` user, `POST /api/trips` → 403 PAYWALL
- [ ] Teaser endpoint `/enriched/teaser` returns shape with all-null fields → 200

## Trip ownership

- [ ] User A creates trip `T1`
- [ ] User B `GET /api/trips/T1` → 404
- [ ] User B `DELETE /api/trips/T1` → 404
- [ ] User A `GET /api/trips/T1` → 200

## Web-push

- [ ] Enable notifications in browser → push endpoint saved
- [ ] Manually trigger `tripAlertWorker.runCycle()` via dev test route (or wait 15 min) → notification delivered
- [ ] Unsubscribe → endpoint deleted; next cycle does not attempt delivery

## Client bundles

- [ ] `npm run build` in `client/` → no warnings about >500KB chunks for pricing
- [ ] Lighthouse on `/pricing` → LCP < 2.5s, no CLS jumps

## Legal

- [ ] `/legal/terms` and `/legal/privacy` load; both linked from pricing footer
- [ ] Email `support@himaxym.com` reaches an inbox that is monitored

## Capacitor (native app)

- [ ] Build native app → `/pricing` route hidden
- [ ] Any "Upgrade" CTA in the native app either (a) doesn't appear, or (b) opens `https://himaxym.com/pricing` via in-app browser (not native IAP — Apple 3.1.1 sidestep)

## Final flip

- [ ] Update `STRIPE_SECRET_KEY` to `sk_live_...`
- [ ] Update `STRIPE_WEBHOOK_SECRET` to live webhook secret (Stripe dashboard → Developers → Webhooks → live endpoint)
- [ ] Set `STRIPE_LIVE=1`
- [ ] Confirm `automatic_tax` enabled in Stripe dashboard → Settings → Tax
- [ ] `git commit --allow-empty -m "chore: flip STRIPE_LIVE=1"` to trigger Actions deploy
- [ ] Repeat the "End-to-end subscription flow" section with a REAL card on the live site; refund yourself via dashboard
```

- [ ] **Step 2: Commit**

```bash
git add docs/launch/smoke-checklist.md
git commit -m "docs(launch): pre-launch smoke checklist for subscription pivot"
```

---

## Task 12: Deploy workflow — document Stripe env pass-through

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Read current env block**

Run: `grep -n -A2 "STRIPE\|VAPID" .github/workflows/deploy.yml`

- [ ] **Step 2: Ensure all env vars are forwarded to PM2 restart**

In the deploy step that runs `pm2 restart flightfinder --update-env`, confirm the following env vars are exported from GitHub Secrets before the restart (add any missing):

```yaml
env:
  STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
  STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_WEBHOOK_SECRET }}
  STRIPE_PRICE_MONTHLY: ${{ secrets.STRIPE_PRICE_MONTHLY }}
  STRIPE_PRICE_ANNUAL: ${{ secrets.STRIPE_PRICE_ANNUAL }}
  STRIPE_PRICE_LIFETIME: ${{ secrets.STRIPE_PRICE_LIFETIME }}
  STRIPE_LIVE: ${{ secrets.STRIPE_LIVE }}
  VAPID_PUBLIC_KEY: ${{ secrets.VAPID_PUBLIC_KEY }}
  VAPID_PRIVATE_KEY: ${{ secrets.VAPID_PRIVATE_KEY }}
  VAPID_CONTACT: ${{ secrets.VAPID_CONTACT }}
  INGEST_ENABLED: ${{ secrets.INGEST_ENABLED }}
  TRIPS_ENABLED: ${{ secrets.TRIPS_ENABLED }}
  ENRICHED_CARD: ${{ secrets.ENRICHED_CARD }}
  OPENWEATHER_KEY: ${{ secrets.OPENWEATHER_KEY }}
```

If the workflow writes a `.env` file on the server, add the same keys there.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(deploy): pass Stripe+VAPID+kill-switch env vars through to PM2"
```

---

## Task 13: Announcement draft

**Files:**
- Create: `docs/launch/announcement-draft.md`

- [ ] **Step 1: Write the announcement template**

```markdown
# Launch announcement drafts

## Blog post / landing page hero

**Title:** himaxym is now a product, not an affiliate link.

Today we're flipping himaxym.com from an aviation search tool into a paid product: $4.99/month, $39/year, or $99 for lifetime (capped at 500 slots).

What you get on Pro:
- **Enriched flight card** — real aircraft, livery photos, on-time record, delay forecast, CO₂ per passenger, cabin amenities, departure gate, live weather at both airports.
- **Delay predictions** — rule-based predictions from our own observation database.
- **My Trips** — save upcoming flights and get web-push alerts when a delay is predicted.

Free tier keeps route search, the aircraft map, and hub network — so nothing you rely on goes away.

## Social (short)

> himaxym.com is now a paid product. $4.99/mo, $39/yr, or $99 lifetime (500 slots only). Free tier stays. Pro unlocks enriched cards, delay predictions, and My Trips with push alerts. → https://himaxym.com/pricing

## Email to waitlist / early users

**Subject:** himaxym is launching Pro — you get first access

Hi,

I'm launching Pro today. Three plans: $4.99/mo, $39/yr, or $99 lifetime (capped at 500 — first come, first served).

What's new:
- Enriched card with aircraft details, livery, on-time stats, CO₂, amenities
- Delay predictions based on our observation database
- My Trips with push notifications

Nothing free is being removed. If it wasn't worth paying for, I'd rather you not pay for it.

→ https://himaxym.com/pricing

— [owner]

## Changelog entry

**2026-MM-DD — Subscription launch**
- New `/pricing` page with three plans
- Enriched flight card (Pro)
- Delay prediction engine (Pro)
- My Trips with web-push alerts (Pro)
- Affiliate booking links removed site-wide
- Legal pages published: /legal/terms, /legal/privacy
```

- [ ] **Step 2: Commit**

```bash
git add docs/launch/announcement-draft.md
git commit -m "docs(launch): announcement templates for blog/social/email"
```

---

## Task 14: Final verification pass

**Files:** no new files — verification only.

- [ ] **Step 1: Client test suite**

Run: `cd client && npx vitest run`
Expected: all suites PASS, including new Pricing, SubscribeReturn, PricingCard, useLifetimeStatus, useCheckout, platform

- [ ] **Step 2: Server test suite**

Run: `cd server && npm test`
Expected: all suites PASS (including Plans 01–04 test suites)

- [ ] **Step 3: Build check**

Run: `cd client && npm run build`
Expected: build succeeds, no warnings about missing affiliate refs

- [ ] **Step 4: Dev smoke**

Run the server + client in dev, log in as a test user, hit:
- `/pricing` → 3 cards, lifetime counter shows a number
- Click Pro Monthly → redirected to Stripe checkout (test mode) with the correct price
- Hit back → `/subscribe/return?subscribe=cancel` → "Checkout cancelled"
- `/legal/terms` + `/legal/privacy` → render
- Site header → Pricing link visible on web
- Native build (if available) → Pricing link absent, `/pricing` route inaccessible

- [ ] **Step 5: Ready-to-deploy commit**

If anything above failed, fix inline and re-run. When everything is green:

```bash
git push origin main
```

Then monitor Actions → on success, work through `docs/launch/smoke-checklist.md` against the live site with `STRIPE_LIVE=0` until every item is ticked; then flip `STRIPE_LIVE=1` per the final section of the checklist.

---

## Out of scope (explicitly)

- **Native IAP (Apple/Google)** — v1 ships web-only checkout; native app hides Pricing entirely. This is intentional (spec decision to sidestep Apple 3.1.1).
- **Coupons / promo codes** — Stripe supports them but we are not exposing a redemption UI in v1. Stripe dashboard coupons still work for manual grants.
- **Team / multi-seat plans** — not in v1.
- **Proration on upgrade/downgrade** — Stripe handles automatically on its end; our UI does not show a preview.
- **Refund self-service** — refunds are manual via Stripe dashboard in v1.
- **Legal translation** — ToS and Privacy are English-only in v1.

---

## Spec coverage summary (plans 01–05)

| Spec section | Covered by |
|---|---|
| Problem / Goal | All plans |
| Tiers & pricing ($4.99/$39/$99) | Plan 01 (price IDs), Plan 05 (Pricing UI) |
| Lifetime 500 cap + atomic counter | Plan 01 |
| Subscription lifecycle (checkout → webhook → tier → renewal) | Plan 01 |
| Entitlement middleware | Plan 01 |
| `checkout.session.expired` slot release | Plan 01 |
| Billing portal | Plan 01 |
| Track 2 data ingestion (observations, fleet, liveries, amenities) | Plan 02 |
| 3-tier delay predictor | Plan 02 |
| CO₂ per pax | Plan 02 |
| Weather | Plan 02 |
| Enriched card endpoints (Pro + teaser) | Plan 03 |
| FlightCard UI refresh + UpgradeModal | Plan 03 |
| Affiliate removal | Plan 03 (card) + Plan 05 (SEO/meta) |
| `ENRICHED_CARD` kill switch | Plan 03 |
| My Trips (owner-scoped CRUD) | Plan 04 |
| Trip status composition | Plan 04 |
| Web-push with VAPID | Plan 04 |
| Trip alert worker | Plan 04 |
| `TRIPS_ENABLED` kill switch | Plan 04 |
| `/pricing` page + live counter | Plan 05 |
| Checkout redirect + return page | Plan 05 |
| ToS + Privacy | Plan 05 |
| Capacitor gate (hide Pricing in native) | Plan 05 |
| Sentry route tags | Plan 05 |
| `STRIPE_LIVE=1` flip procedure | Plan 05 |
| Launch checklist + announcement | Plan 05 |

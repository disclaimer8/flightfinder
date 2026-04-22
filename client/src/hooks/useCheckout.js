import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export function useCheckout() {
  // useAuth may be absent during tests that render the hook without the
  // provider — guard so the hook still works in unit tests.
  let auth = null;
  try { auth = useAuth(); } catch { /* no provider */ }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const start = useCallback(async (tier) => {
    setLoading(true);
    setError(null);
    try {
      const token = auth?.getToken?.();
      const res = await fetch('/api/subscriptions/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Server emits `code` (Plan 1 convention) — accept `error` too for
        // compatibility with older tests / any middleware that flips naming.
        const code = data.code || data.error;
        if (code === 'LIFETIME_SOLD_OUT' || code === 'SOLD_OUT') {
          throw new Error('Lifetime sold out — try Pro Monthly or Annual');
        }
        if (code === 'PAYWALL' || res.status === 401 || code === 'AUTH_REQUIRED') {
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
  }, [auth]);

  return { start, loading, error };
}

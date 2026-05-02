import { useState, useEffect } from 'react';
import { API_BASE } from '../utils/api';
import { useAuth } from '../context/AuthContext';

// Module-level promise cache prevents thundering-herd when N FlightCards mount
// simultaneously. Same (flightId, tier, hasToken) → one in-flight request.
// TTL 5 min — enriched data (gate, weather, livery, on-time) doesn't change
// faster than that. Searches that revisit flights within session hit cache.
const _enrichedCache = new Map();
const _ENRICHED_TTL_MS = 5 * 60 * 1000;

// Pro users: fetch /enriched; free users: fetch /enriched/teaser (same shape, nulls).
// flight prop shape: { id, departure:{code}, arrival:{code}, aircraft:{icaoType, registration} }
export function useEnrichedCard(flight) {
  const { user, getToken } = useAuth();
  const [state, setState] = useState({ loading: false, data: null, tier: null, error: null });

  useEffect(() => {
    if (!flight?.id) return;
    let active = true;
    const isPro = !!user?.subscription_tier?.startsWith('pro_');
    const token = getToken?.();
    const cacheKey = `${flight.id}|${isPro ? 'pro' : 'free'}|${token ? 'auth' : 'anon'}`;

    setState((s) => ({ ...s, loading: true, error: null }));

    let promise;
    const cached = _enrichedCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < _ENRICHED_TTL_MS) {
      promise = cached.promise;
    } else {
      const qs = new URLSearchParams({
        dep:  flight.departure?.code || '',
        arr:  flight.arrival?.code || '',
        type: flight.aircraft?.icaoType || '',
        reg:  flight.aircraft?.registration || '',
      }).toString();
      const teaserUrl   = `${API_BASE}/api/flights/${encodeURIComponent(flight.id)}/enriched/teaser`;
      const enrichedUrl = `${API_BASE}/api/flights/${encodeURIComponent(flight.id)}/enriched?${qs}`;
      // Pro users hit /enriched with their bearer; if the token is stale or
      // the subscription has been downgraded server-side, the API returns
      // 401/403. Rather than surfacing a generic "Could not load extra info"
      // banner, transparently fall back to /teaser so the user still sees
      // blurred placeholders instead of a broken UI. A page rendering 30+
      // FlightCards fans out 30+ teaser fetches; if rate-limiter (429) or
      // upstream timeout makes that endpoint unhappy, treat it the same way:
      // return a tier:'free'/data:null shape so the card renders blurred
      // teasers without an angry red banner.
      const SOFT_FAIL = { success: true, tier: 'free', data: null };
      const fetchWithFallback = async () => {
        if (isPro && token) {
          try {
            const r = await fetch(enrichedUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (r.status !== 401 && r.status !== 403 && r.status !== 429) return r.json();
          } catch { /* fall through to teaser */ }
        }
        try {
          const r2 = await fetch(teaserUrl);
          if (r2.status === 429 || !r2.ok) return SOFT_FAIL;
          return r2.json();
        } catch {
          return SOFT_FAIL;
        }
      };
      promise = fetchWithFallback();
      _enrichedCache.set(cacheKey, { at: Date.now(), promise });
      // Evict on error so retries can re-fire
      promise.catch(() => _enrichedCache.delete(cacheKey));
    }

    promise
      .then((j) => {
        if (!active) return;
        if (!j.success) throw new Error(j.message || 'enrich failed');
        setState({ loading: false, data: j.data, tier: j.tier, error: null });
      })
      .catch((err) => {
        if (!active) return;
        setState({ loading: false, data: null, tier: null, error: err.message });
      });

    return () => { active = false; };
  }, [flight?.id, user?.subscription_tier, getToken]);

  return state;
}

export function _clearEnrichedCache() { _enrichedCache.clear(); }

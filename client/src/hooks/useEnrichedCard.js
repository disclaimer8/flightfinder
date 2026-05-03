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
      // Pro users hit /enriched with their bearer; if the token is stale,
      // the subscription has been downgraded server-side, the rate-limiter
      // is hot, or the enrichment service blew up on a third-party call
      // (livery / weather / airlabs gate / NOAA METAR — any one of them
      // can throw and bubble up as 500), we transparently fall back to
      // /teaser so the user still sees blurred placeholders instead of
      // a generic "Could not load extra info" banner. A page rendering
      // 30+ FlightCards fans out 30+ teaser fetches; if rate-limiter
      // (429) or upstream timeout makes that endpoint unhappy, treat it
      // the same way: return a tier:'free'/data:null shape so the card
      // renders blurred teasers without an angry red banner.
      const SOFT_FAIL = { success: true, tier: 'free', data: null };
      const fetchWithFallback = async () => {
        if (isPro && token) {
          try {
            const r = await fetch(enrichedUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (r.ok) {
              const j = await r.json().catch(() => null);
              // Only trust the body if it really did succeed; a 200 with
              // success:false (or non-JSON) drops to the teaser fallback.
              if (j && j.success) return j;
            }
            // Any non-2xx, JSON-parse error, or success:false: fall through.
          } catch { /* network / fetch threw — fall through to teaser */ }
        }
        try {
          const r2 = await fetch(teaserUrl);
          if (!r2.ok) return SOFT_FAIL;
          const j2 = await r2.json().catch(() => null);
          if (!j2 || !j2.success) return SOFT_FAIL;
          return j2;
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

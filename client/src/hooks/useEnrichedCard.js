import { useState, useEffect } from 'react';
import { API_BASE } from '../utils/api';
import { useAuth } from '../context/AuthContext';

// Pro users: fetch /enriched; free users: fetch /enriched/teaser (same shape, nulls).
// flight prop shape: { id, departure:{code}, arrival:{code}, aircraft:{icaoType, registration} }
export function useEnrichedCard(flight) {
  const { user, getToken } = useAuth();
  const [state, setState] = useState({ loading: false, data: null, tier: null, error: null });

  useEffect(() => {
    if (!flight?.id) return;
    const controller = new AbortController();
    const isPro = !!user?.subscription_tier?.startsWith('pro_');
    const token = getToken?.();

    const qs = new URLSearchParams({
      dep:  flight.departure?.code || '',
      arr:  flight.arrival?.code || '',
      type: flight.aircraft?.icaoType || '',
      reg:  flight.aircraft?.registration || '',
    }).toString();

    const url = isPro
      ? `${API_BASE}/api/flights/${encodeURIComponent(flight.id)}/enriched?${qs}`
      : `${API_BASE}/api/flights/${encodeURIComponent(flight.id)}/enriched/teaser`;

    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url, {
      signal: controller.signal,
      headers: isPro && token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) throw new Error(j.message || 'enrich failed');
        setState({ loading: false, data: j.data, tier: j.tier, error: null });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState({ loading: false, data: null, tier: null, error: err.message });
      });

    return () => controller.abort();
  }, [flight?.id, user?.subscription_tier, getToken]);

  return state;
}

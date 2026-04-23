import { API_BASE } from '../../utils/api';

export async function fetchEvents({ limit = 50, offset = 0, severity = null, country = null } = {}) {
  const qs = new URLSearchParams();
  qs.set('limit', String(limit));
  qs.set('offset', String(offset));
  if (severity) qs.set('severity', severity);
  if (country)  qs.set('country',  country);
  const r = await fetch(`${API_BASE}/api/safety/events?${qs.toString()}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function fetchEvent(id) {
  const r = await fetch(`${API_BASE}/api/safety/events/${encodeURIComponent(id)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  return body.data;
}

// Promise-level cache prevents thundering-herd when N FlightCards mount with
// the same airline (e.g. 10 LHR→JFK flights × 3 airlines = 30 identical calls
// before cache hit). Keyed by "code|hasToken" so Pro users (who get extended
// proStats) don't share cache with anonymous requests. TTL 5 min — safety
// counts change daily at most.
const _operatorCache = new Map();
const _OPERATOR_CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchOperator(code, token) {
  const key = `${code}|${token ? 'auth' : 'anon'}`;
  const cached = _operatorCache.get(key);
  if (cached && (Date.now() - cached.at) < _OPERATOR_CACHE_TTL_MS) {
    return cached.promise;
  }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const promise = (async () => {
    const r = await fetch(`${API_BASE}/api/safety/operators/${encodeURIComponent(code)}`, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })();
  _operatorCache.set(key, { at: Date.now(), promise });
  // Evict on error so next caller can retry
  promise.catch(() => _operatorCache.delete(key));
  return promise;
}

export function _clearOperatorCache() { _operatorCache.clear(); }

export async function fetchAircraft(reg, token) {
  const r = await fetch(`${API_BASE}/api/safety/aircraft/${encodeURIComponent(reg)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401 || r.status === 403) {
    return { paywall: true };
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

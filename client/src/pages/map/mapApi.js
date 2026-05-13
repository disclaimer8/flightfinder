import { API_BASE } from '../../utils/api';

// ── fetchRoutes ───────────────────────────────────────────────────────────────
// Calls GET /api/map/routes with optional airline= and aircraft= query params.
// Omits params that are falsy. Returns the unwrapped routes array.
export async function fetchRoutes({ airline, aircraft } = {}) {
  const qs = new URLSearchParams();
  if (airline)  qs.set('airline',  airline);
  if (aircraft) qs.set('aircraft', aircraft);
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await fetch(`${API_BASE}/api/map/routes${suffix}`);
  if (!r.ok) throw new Error(`fetchRoutes: HTTP ${r.status}`);
  const body = await r.json();
  return Array.isArray(body.routes) ? body.routes : [];
}

// ── fetchFilters ──────────────────────────────────────────────────────────────
// Calls GET /api/map/filters once per session. Subsequent calls during the
// same page lifecycle return the same in-flight or resolved promise — no
// thundering-herd when multiple components mount simultaneously.
// Returns { airlines: [{iata, name, count}], aircraft: [{icao, label, count}] }.
let _filtersPromise = null;

export function fetchFilters() {
  if (_filtersPromise) return _filtersPromise;
  _filtersPromise = fetch(`${API_BASE}/api/map/filters`)
    .then(r => {
      if (!r.ok) throw new Error(`fetchFilters: HTTP ${r.status}`);
      return r.json();
    })
    .then(body => ({
      airlines: Array.isArray(body.airlines) ? body.airlines : [],
      aircraft: Array.isArray(body.aircraft) ? body.aircraft : [],
    }))
    .catch(err => {
      // Evict on error so a future caller can retry
      console.warn('fetchFilters failed:', err.message);
      _filtersPromise = null;
      throw err;
    });
  return _filtersPromise;
}

// Exported for tests only — resets the module-level promise cache.
export function _clearFiltersCache() {
  _filtersPromise = null;
}

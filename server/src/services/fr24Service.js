// server/src/services/fr24Service.js
//
// Low-level client for the Flightradar24 API. Handles auth, throttling, and
// the derivation logic that turns raw FR24 responses into aggregated stats.
//
// Raw responses NEVER leave this module. Only DerivedStats objects cross
// the boundary. This is load-bearing for FR24 TOS compliance — see
// docs/superpowers/specs/2026-05-10-fr24-integration-design.md.

const axios = require('axios');

const FR24_BASE = 'https://fr24api.flightradar24.com/api';
const REQUEST_TIMEOUT_MS = 15000;
const THROTTLE_INTERVAL_MS = 7500;  // 8 req/min — under Explorer's 10/min limit

let _warnedNoKey = false;
let _lastRequestAt = 0;

function isEnabled() {
  return Boolean(process.env.FR24_API_KEY);
}

function _client() {
  return axios.create({
    baseURL: FR24_BASE,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${process.env.FR24_API_KEY}`,
      'Accept-Version': 'v1',
      Accept: 'application/json',
    },
  });
}

// Simple sequential throttle: enforces a minimum gap between outbound requests.
async function _throttledGet(path, params) {
  const wait = THROTTLE_INTERVAL_MS - (Date.now() - _lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastRequestAt = Date.now();
  return _client().get(path, { params });
}

// One-shot retry on 429 / 5xx with a short backoff. Auth (4xx) errors propagate
// immediately so the public-method catch can log them with the right message.
async function _throttledGetWithRetry(path, params) {
  try {
    return await _throttledGet(path, params);
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || (status >= 500 && status < 600)) {
      await new Promise((r) => setTimeout(r, 500));
      return _throttledGet(path, params);
    }
    throw err;
  }
}

function _logDisabledOnce() {
  if (_warnedNoKey) return;
  _warnedNoKey = true;
  console.warn('[fr24] disabled (no FR24_API_KEY in env)');
}

function _logFetchError(method, key, err) {
  const status = err.response?.status;
  if (status === 401 || status === 403) {
    console.warn(`[fr24] ${method}(${key}): auth error ${status} — check FR24_API_KEY`);
  } else if (status === 429) {
    console.warn(`[fr24] ${method}(${key}): rate-limited (429) after retry`);
  } else if (status >= 500) {
    console.warn(`[fr24] ${method}(${key}): server error ${status} after retry`);
  } else if (err.code === 'ECONNABORTED') {
    console.warn(`[fr24] ${method}(${key}): timeout`);
  } else {
    console.warn(`[fr24] ${method}(${key}): ${err.message || 'unknown error'}`);
  }
}

// ── private helpers ─────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function _formatDate(ms) {
  // FR24 wants 'YYYY-MM-DD HH:MM:SS' (UTC)
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function _windowParams(windowDays) {
  const now = Date.now();
  return {
    flight_datetime_from: _formatDate(now - windowDays * ONE_DAY_MS),
    flight_datetime_to: _formatDate(now),
  };
}

function _topN(rows, keyFn, n = 5) {
  const counts = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// Field-name safety: /light docs say `origin_icao`/`destination_icao` but our
// production probes have seen `orig_icao`/`dest_icao` too (and `operating_as`
// vs docs' `operated_as`). Read both shapes — whichever the API returns wins.
function _orig(r)  { return r.orig_icao || r.origin_icao; }
function _dest(r)  { return r.dest_icao || r.destination_icao; }
function _carrier(r) { return r.operating_as || r.operated_as; }

function _deriveFromLight(rows) {
  const operatorTop = _topN(rows, _carrier);
  const routeTop = _topN(rows, (r) => {
    const o = _orig(r); const d = _dest(r);
    return o && d ? `${o}|${d}` : null;
  });
  return {
    uniqueOperators: new Set(rows.map(_carrier).filter(Boolean)).size,
    topOperators: operatorTop.map(([icao, count]) => ({ icao, count })),
    topRoutes: routeTop.map(([key, count]) => {
      const [from, to] = key.split('|');
      return { from, to, count };
    }),
  };
}

// Explorer tier ($9/mo) provides 30 days of history. The /flight-summary/count
// endpoint we used originally is not part of any documented tier — 403 on prod —
// so we derive totalFlights from light rows.length. /light caps at 20000 rows
// per query, which is more than enough at a 30-day window for any single
// aircraft type or family in our enumeration.
const MAX_WINDOW_DAYS = parseInt(process.env.FR24_MAX_WINDOW_DAYS || '30', 10);

async function _fetchLight(filterParams, windowDays) {
  const days = Math.min(windowDays, MAX_WINDOW_DAYS);
  const params = { ..._windowParams(days), ...filterParams, limit: 20000, sort: 'desc' };
  const lightRes = await _throttledGetWithRetry('/flight-summary/light', params);
  const lightRows = Array.isArray(lightRes.data?.data) ? lightRes.data.data : [];
  // totalFlights is the rows we observed. If the 20000 cap is hit, this is a
  // floor (we mark it with `truncated: true` so the renderer can hint "20000+").
  return {
    totalFlights: lightRows.length,
    truncated: lightRows.length >= 20000,
    lightRows,
    windowDays: days,
  };
}

// ── public methods ──────────────────────────────────────────────────────

const FAMILY_MAX_CODES = 15;

async function fetchVariantStats(icao, _opts = {}) {
  if (!isEnabled()) { _logDisabledOnce(); return null; }
  try {
    const { totalFlights, truncated, lightRows, windowDays } =
      await _fetchLight({ aircraft: icao }, MAX_WINDOW_DAYS);
    const derived = _deriveFromLight(lightRows);
    return {
      totalFlights,
      truncated,
      uniqueOperators: derived.uniqueOperators,
      topOperators: derived.topOperators,
      topRoutes: derived.topRoutes,
      yearlyBreakdown: null, // not available on Explorer tier (needs /count or 1yr+ history)
      windowDays,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    _logFetchError('fetchVariantStats', icao, err);
    return null;
  }
}

async function fetchFamilyStats(icaoList, _opts = {}) {
  if (!isEnabled()) { _logDisabledOnce(); return null; }
  if (!Array.isArray(icaoList) || icaoList.length === 0) return null;

  let codes = icaoList;
  if (codes.length > FAMILY_MAX_CODES) {
    console.warn(`[fr24] family ICAO list (${codes.length}) truncated to 15 — FR24 max`);
    codes = codes.slice(0, FAMILY_MAX_CODES);
  }

  const aircraftParam = codes.join(',');
  try {
    const { totalFlights, truncated, lightRows, windowDays } =
      await _fetchLight({ aircraft: aircraftParam }, MAX_WINDOW_DAYS);
    const derived = _deriveFromLight(lightRows);
    return {
      totalFlights,
      truncated,
      uniqueOperators: derived.uniqueOperators,
      topOperators: derived.topOperators,
      topRoutes: derived.topRoutes,
      yearlyBreakdown: null,
      windowDays,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    _logFetchError('fetchFamilyStats', aircraftParam, err);
    return null;
  }
}

async function fetchRouteStats(orig, dest, _opts = {}) {
  if (!isEnabled()) { _logDisabledOnce(); return null; }
  if (!orig || !dest) return null;

  try {
    const { totalFlights, truncated, lightRows, windowDays } =
      await _fetchLight({ routes: `${orig}-${dest}` }, MAX_WINDOW_DAYS);
    const derived = _deriveFromLight(lightRows);
    return {
      totalFlights,
      truncated,
      uniqueOperators: derived.uniqueOperators,
      topOperators: derived.topOperators,
      yearlyBreakdown: null,
      windowDays,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    _logFetchError('fetchRouteStats', `${orig}-${dest}`, err);
    return null;
  }
}

module.exports = {
  isEnabled,
  fetchVariantStats,
  fetchFamilyStats,
  fetchRouteStats,
  // Internal — exposed only for testing
  _internal: { _throttledGet, _client, FR24_BASE, THROTTLE_INTERVAL_MS },
};

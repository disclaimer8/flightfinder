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

function _deriveFromLight(rows) {
  const operatorTop = _topN(rows, (r) => r.operating_as);
  const routeTop = _topN(rows, (r) => r.orig_icao && r.dest_icao ? `${r.orig_icao}|${r.dest_icao}` : null);
  return {
    uniqueOperators: new Set(rows.map((r) => r.operating_as).filter(Boolean)).size,
    topOperators: operatorTop.map(([icao, count]) => ({ icao, count })),
    topRoutes: routeTop.map(([key, count]) => {
      const [from, to] = key.split('|');
      return { from, to, count };
    }),
  };
}

async function _fetchCountAndLight(filterParams, windowDays) {
  const params = { ..._windowParams(windowDays), ...filterParams };
  const countRes = await _throttledGetWithRetry('/flight-summary/count', params);
  const lightRes = await _throttledGetWithRetry('/flight-summary/light', { ...params, limit: 20000, sort: 'desc' });

  const countData = Array.isArray(countRes.data?.data) ? countRes.data.data : [];
  const lightRows = Array.isArray(lightRes.data?.data) ? lightRes.data.data : [];

  const totalFlights = countData[0]?.record_count ?? 0;
  return { totalFlights, lightRows };
}

async function _fetchYearlyCounts(filterParams) {
  const out = [];
  const nowYear = new Date().getUTCFullYear();
  for (let i = 0; i < 5; i++) {
    const year = nowYear - i;
    const from = `${year}-01-01 00:00:00`;
    const to = `${year}-12-31 23:59:59`;
    try {
      const res = await _throttledGetWithRetry('/flight-summary/count', {
        ...filterParams,
        flight_datetime_from: from,
        flight_datetime_to: to,
      });
      const count = res.data?.data?.[0]?.record_count ?? 0;
      out.push({ year, count });
    } catch (err) {
      console.warn(`[fr24] yearly count failed year=${year} filter=${JSON.stringify(filterParams)}: ${err.message || err}`);
      out.push({ year, count: 0 });
    }
  }
  return out;  // already newest-first by construction
}

// ── public methods ──────────────────────────────────────────────────────

const FAMILY_MAX_CODES = 15;

async function fetchVariantStats(icao, opts = {}) {
  if (!isEnabled()) { _logDisabledOnce(); return null; }
  try {
    const windowDays = opts.windowDays || 365;
    const { totalFlights, lightRows } = await _fetchCountAndLight({ aircraft: icao }, windowDays);
    const derived = _deriveFromLight(lightRows);
    const yearlyBreakdown = opts.withYearly
      ? await _fetchYearlyCounts({ aircraft: icao })
      : null;
    return {
      totalFlights,
      uniqueOperators: derived.uniqueOperators,
      topOperators: derived.topOperators,
      topRoutes: derived.topRoutes,
      yearlyBreakdown,
      windowDays,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    _logFetchError('fetchVariantStats', icao, err);
    return null;
  }
}

async function fetchFamilyStats(icaoList, opts = {}) {
  if (!isEnabled()) { _logDisabledOnce(); return null; }
  if (!Array.isArray(icaoList) || icaoList.length === 0) return null;

  let codes = icaoList;
  if (codes.length > FAMILY_MAX_CODES) {
    console.warn(`[fr24] family ICAO list (${codes.length}) truncated to 15 — FR24 max`);
    codes = codes.slice(0, FAMILY_MAX_CODES);
  }

  const aircraftParam = codes.join(',');
  try {
    const windowDays = opts.windowDays || 365;
    const { totalFlights, lightRows } = await _fetchCountAndLight(
      { aircraft: aircraftParam },
      windowDays,
    );
    const derived = _deriveFromLight(lightRows);
    const yearlyBreakdown = opts.withYearly
      ? await _fetchYearlyCounts({ aircraft: aircraftParam })
      : null;
    return {
      totalFlights,
      uniqueOperators: derived.uniqueOperators,
      topOperators: derived.topOperators,
      topRoutes: derived.topRoutes,
      yearlyBreakdown,
      windowDays,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    _logFetchError('fetchFamilyStats', aircraftParam, err);
    return null;
  }
}

async function fetchRouteStats(orig, dest, opts = {}) {
  if (!isEnabled()) { _logDisabledOnce(); return null; }
  if (!orig || !dest) return null;

  try {
    const windowDays = opts.windowDays || 365;
    const { totalFlights, lightRows } = await _fetchCountAndLight(
      { routes: `${orig}-${dest}` },
      windowDays,
    );
    const derived = _deriveFromLight(lightRows);

    // No topRoutes — the page IS the route. Save bytes in cache and HTML.
    return {
      totalFlights,
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

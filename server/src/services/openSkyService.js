'use strict';

const axios       = require('axios');
const openFlights = require('./openFlightsService');

// In-memory cache: icao → { routes: [{destIata, lastSeen}], fetchedAt }
const _cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h — re-fetch twice a day for fresh live data

// OpenSky free authenticated tier allows up to ~12 h lookback for /flights/departure.
// Anything beyond that returns 403 "cannot access historical flights".
const MAX_HOURS_BACK = 12;

/** Exposed for tests only */
exports._clearCache = () => _cache.clear();

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

// In-process token cache. Tokens last ~30 minutes (expires_in=1800), we refresh 60s early.
let _tokenCache = { accessToken: null, expiresAt: 0 };

async function getAccessToken() {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null; // anonymous mode

  if (_tokenCache.accessToken && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.accessToken;
  }

  try {
    const res = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: id,
        client_secret: secret,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
        validateStatus: () => true,
      }
    );
    if (res.status !== 200 || !res.data?.access_token) {
      console.warn(`[openSky] OAuth2 token exchange failed (HTTP ${res.status})`);
      return null;
    }
    const expiresIn = Number(res.data.expires_in) || 300;
    _tokenCache = {
      accessToken: res.data.access_token,
      expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
    };
    return _tokenCache.accessToken;
  } catch (err) {
    console.warn(`[openSky] OAuth2 token exchange error: ${err.message}`);
    return null;
  }
}

// Exposed for tests to reset between suites.
exports._clearTokenCache = () => { _tokenCache = { accessToken: null, expiresAt: 0 }; };

/**
 * Fetch direct destination airports seen departing from `icao` in the last
 * `daysBack` days (max 7 — OpenSky free tier limit per request).
 *
 * Requires OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET env vars (OAuth2 client
 * credentials — register at https://opensky-network.org/my-opensky/account).
 * Falls back to anonymous access (reduced rate limits) when creds are absent.
 * Returns [] silently when unauthenticated, rate-limited, or airport unknown.
 *
 * @param {string} icao   4-letter ICAO code of origin airport
 * @param {number} hoursBack  1–12 (free authenticated tier limit)
 * @returns {Promise<{destIata: string, lastSeen: Date}[]>}
 */
exports.getDepartures = async (icao, hoursBack = MAX_HOURS_BACK) => {
  if (!icao) return [];

  const code = icao.toUpperCase();

  // Return cached data if fresh
  const cached = _cache.get(code);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.routes;
  }

  const endUnix   = Math.floor(Date.now() / 1000);
  const beginUnix = endUnix - Math.min(hoursBack, MAX_HOURS_BACK) * 3600;

  const url = `https://opensky-network.org/api/flights/departure?airport=${code}&begin=${beginUnix}&end=${endUnix}`;

  const config = {};
  const token = await getAccessToken();
  if (token) {
    config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
  }

  let raw = [];
  try {
    const res = await axios.get(url, { ...config, timeout: 15000 });
    raw = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    // 404 = no flights in window; 429 = rate limited; network errors
    console.warn(`[opensky] fetch failed for ${code}: ${err?.response?.status ?? err.message}`);
    // Return stale cache if available
    return cached ? cached.routes : [];
  }

  // Deduplicate: keep most recent lastSeen per destination
  const byDest = new Map();
  for (const flight of raw) {
    const destIcao = flight.estArrivalAirport;
    if (!destIcao) continue;
    const airport = openFlights.getAirportByIcao(destIcao);
    if (!airport) continue;
    const lastSeen = new Date(flight.lastSeen * 1000);
    const prev = byDest.get(airport.iata);
    if (!prev || lastSeen > prev) byDest.set(airport.iata, lastSeen);
  }

  const routes = Array.from(byDest.entries()).map(([destIata, lastSeen]) => ({ destIata, lastSeen }));
  _cache.set(code, { routes, fetchedAt: Date.now() });
  return routes;
};

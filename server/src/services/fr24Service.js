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

function _logDisabledOnce() {
  if (_warnedNoKey) return;
  _warnedNoKey = true;
  console.warn('[fr24] disabled (no FR24_API_KEY in env)');
}

async function fetchVariantStats(_icao, _opts) {
  if (!isEnabled()) { _logDisabledOnce(); return null; }
  return null;  // implemented in Task 3
}

async function fetchFamilyStats(_icaoList, _opts) {
  if (!isEnabled()) { _logDisabledOnce(); return null; }
  return null;  // implemented in Task 4
}

async function fetchRouteStats(_orig, _dest, _opts) {
  if (!isEnabled()) { _logDisabledOnce(); return null; }
  return null;  // implemented in Task 5
}

module.exports = {
  isEnabled,
  fetchVariantStats,
  fetchFamilyStats,
  fetchRouteStats,
  // Internal — exposed only for testing
  _internal: { _throttledGet, _client, FR24_BASE, THROTTLE_INTERVAL_MS },
};

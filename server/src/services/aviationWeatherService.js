// server/src/services/aviationWeatherService.js
'use strict';

const { defineDataSource } = require('./dataSource');

const BASE = 'https://aviationweather.gov/api/data/metar';
const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // icao -> { at, data }

// Wind from METAR is reported in knots. 1 knot ≈ 0.514 m/s (same unit as OpenWeather).
const KT_TO_MPS = 0.514;

function isEnabled() { return true; } // No key required.

async function fetchMetar({ icao }) {
  if (!icao) return null;
  const key = String(icao).toUpperCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.data;

  const url = `${BASE}?ids=${encodeURIComponent(key)}&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[avwx] ${res.status} for ${key}`);
      return null;
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;

    const data = {
      tempC:      Number.isFinite(row.temp)  ? Math.round(row.temp)  : null,
      windMps:    Number.isFinite(row.wspd)  ? Math.round(row.wspd * KT_TO_MPS * 10) / 10 : null,
      condition:  row.wxString || null,
      description: row.rawOb || null,
      icon:       null,
      observedAt: row.obsTime ? row.obsTime * 1000 : now,
      source:     'noaa-metar',
    };
    cache.set(key, { at: now, data });
    return data;
  } catch (err) {
    console.warn(`[avwx] ${key}: ${err.message}`);
    return null;
  }
}

module.exports = defineDataSource({
  name: 'aviationweather',
  isEnabled,
  fetch: fetchMetar,
});
module.exports._clearCache = () => cache.clear();

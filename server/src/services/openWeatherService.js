'use strict';

const { defineDataSource } = require('./dataSource');

const BASE = 'https://api.openweathermap.org/data/2.5/weather';
const TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // key -> { at, data }

function isEnabled() {
  return Boolean(process.env.OPENWEATHER_API_KEY);
}

async function fetchByAirport({ lat, lon }) {
  if (!isEnabled()) return null;
  const key = `${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.data;

  const url = `${BASE}?lat=${lat}&lon=${lon}&units=metric&appid=${process.env.OPENWEATHER_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[openweather] ${res.status} for ${key}`);
    return null;
  }
  const raw = await res.json();
  const data = {
    tempC:      raw.main?.temp != null ? Math.round(raw.main.temp) : null,
    condition:  raw.weather?.[0]?.main || null,
    description: raw.weather?.[0]?.description || null,
    windMps:    raw.wind?.speed || null,
    icon:       raw.weather?.[0]?.icon || null,
    observedAt: raw.dt ? raw.dt * 1000 : now,
  };
  cache.set(key, { at: now, data });
  return data;
}

module.exports = defineDataSource({
  name: 'openweather',
  isEnabled,
  fetch: fetchByAirport,
});
module.exports._clearCache = () => cache.clear(); // test helper

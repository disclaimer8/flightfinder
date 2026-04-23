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

export async function fetchOperator(code, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API_BASE}/api/safety/operators/${encodeURIComponent(code)}`, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

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

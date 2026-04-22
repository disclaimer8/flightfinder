import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../utils/api';
import { useAuth } from '../context/AuthContext';

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useTrips() {
  const { getToken } = useAuth();
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/trips`, { headers: authHeaders(getToken?.()) });
      const j = await res.json();
      if (!j.success) throw new Error(j.message);
      setTrips(j.data);
    } catch (e) {
      setError(e.message);
    }
  }, [getToken]);

  useEffect(() => { refresh(); }, [refresh]);
  return { trips, error, refresh };
}

export async function addTrip(payload, token) {
  const res = await fetch(`${API_BASE}/api/trips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteTrip(id, token) {
  const res = await fetch(`${API_BASE}/api/trips/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  return res.json();
}

export async function fetchTripStatus(id, token) {
  const res = await fetch(`${API_BASE}/api/trips/${id}/status`, { headers: authHeaders(token) });
  return res.json();
}

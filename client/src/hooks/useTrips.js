import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../utils/api';
import { useAuth } from '../context/AuthContext';

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useTrips() {
  const { getToken, user, loading: authLoading } = useAuth();
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const token = getToken?.();
    if (!token) {
      // Session not yet restored or user genuinely logged out — don't fire
      // a guaranteed-401 request. The effect below re-fires once auth settles.
      setTrips([]);
      setError(null);
      return;
    }
    try {
      setError(null);
      const res = await fetch(`${API_BASE}/api/trips`, { headers: authHeaders(token) });
      const j = await res.json();
      if (!j.success) throw new Error(j.message || 'Failed to load trips');
      setTrips(j.data);
    } catch (e) {
      setError(e.message);
    }
  }, [getToken]);

  useEffect(() => {
    // Wait for AuthContext to finish its one-shot /refresh attempt, then
    // fetch. user changing (login/logout) also re-triggers.
    if (authLoading) return;
    refresh();
  }, [authLoading, user, refresh]);

  return { trips, error, refresh, authLoading };
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

import { useState, useCallback, useRef, useEffect } from 'react';
import { API_BASE } from '../utils/api';
import { searchAffectingHash, isSearchReady } from '../utils/searchParams';

/**
 * URL-driven flight search hook for the Phase 2 /search page.
 * Auto-fires GET /api/flights when state's searchAffectingHash changes.
 * Filter-only and display-only param changes do not trigger refetch —
 * the consumer (Search.jsx) re-filters/re-sorts cached `flights` in memory.
 *
 * @param {object|null} state - canonical state from parseSearchParams, or null
 *   to disable (e.g. while URL params are incomplete).
 * @returns {{ flights, loading, loadingMessage, error, apiSource, hasSearched, clearError }}
 */
export function useUrlFlightSearch(state) {
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [apiSource, setApiSource] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  const abortControllerRef = useRef(null);
  const lastHashRef = useRef('');

  const cancelPending = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
  };

  useEffect(() => {
    if (!state || !isSearchReady(state)) return;
    const hash = searchAffectingHash(state);
    if (hash === lastHashRef.current) return;
    lastHashRef.current = hash;

    cancelPending();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setError(null);
    setLoading(true);
    setLoadingMessage('Searching flights…');

    const params = new URLSearchParams({
      departure: state.from,
      arrival: state.to,
      date: state.date,
      passengers: String(state.pax),
      cabin: state.cabin,
    });
    if (state.return) params.set('returnDate', state.return);
    if (state.flexDates) params.set('flex_dates', '1');
    if (state.direct) params.set('directOnly', '1');

    fetch(`${API_BASE}/api/flights?${params.toString()}`, { signal: controller.signal })
      .then(r => {
        if (!r.ok) {
          return r.json().catch(() => ({})).then(b => {
            throw new Error(b.error || b.message || r.statusText || 'Search failed');
          });
        }
        return r.json();
      })
      .then(data => {
        setFlights(data.data || []);
        setApiSource(data.source);
        setHasSearched(true);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        console.error('Error searching flights:', err);
        setError(`Search failed: ${err.message || 'unknown'}`);
      })
      .finally(() => {
        setLoading(false);
      });

    // Cleanup on unmount or before next effect run: abort any in-flight fetch
    // so a slow response can't setState on an unmounted component (React
    // emits a warning and we'd leak the AbortController otherwise).
    return () => { if (abortControllerRef.current) abortControllerRef.current.abort(); };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearError = useCallback(() => setError(null), []);

  return { flights, loading, loadingMessage, error, apiSource, hasSearched, clearError };
}

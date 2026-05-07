import { useState, useCallback, useRef, useEffect } from 'react';
import { buildFlightParams } from '../utils/flightUtils';
import { API_BASE } from '../utils/api';
import { searchAffectingHash, isSearchReady } from '../utils/searchParams';

export function useFlightSearch(filterOptions) {
  const [flights, setFlights] = useState([]);
  const [exploreResults, setExploreResults] = useState(null);
  const [exploreContext, setExploreContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [apiSource, setApiSource] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchedAirlines, setSearchedAirlines] = useState([]);

  // Track in-flight request so we can cancel if user submits again
  const abortControllerRef = useRef(null);

  const cancelPending = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSearch = useCallback(async (filters) => {
    cancelPending();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setExploreResults(null);
    setExploreContext(null);
    setError(null);
    setLoading(true);
    setLoadingMessage('Searching flights…');

    try {
      const params = buildFlightParams(filters);
      const res = await fetch(`${API_BASE}/api/flights?${params}`, { signal: controller.signal });
      if (!res.ok) {
        let detail = res.statusText;
        try { const body = await res.json(); detail = body.error || body.message || detail; } catch (_) {}
        throw new Error(detail);
      }
      const data = await res.json();
      setFlights(data.data || []);
      setApiSource(data.source);
      setHasSearched(true);
      setSearchedAirlines(filters.airlines || []);
      // Scroll to results so loading skeleton / cards are visible on mobile
      setTimeout(() => window.scrollTo({ top: window.innerHeight * 0.6, behavior: 'smooth' }), 100);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Error searching flights:', err);
      const detail = err?.message || 'unknown';
      setError(`Search failed: ${detail}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleExplore = useCallback(async (params) => {
    cancelPending();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setFlights([]);
    setHasSearched(false);
    setError(null);
    setLoading(true);
    setLoadingMessage('Scanning destinations…');

    try {
      const p = new URLSearchParams();
      p.append('departure', params.departure);
      if (params.date)          p.append('date', params.date);
      if (params.aircraftType)  p.append('aircraftType', params.aircraftType);
      if (params.aircraftModel) p.append('aircraftModel', params.aircraftModel);

      const res = await fetch(`${API_BASE}/api/flights/explore?${p}`, { signal: controller.signal });
      if (!res.ok) {
        let detail = res.statusText;
        try { const body = await res.json(); detail = body.error || body.message || detail; } catch (_) {}
        throw new Error(detail);
      }
      const data = await res.json();
      setExploreResults(data.data || []);

      const ac = params.aircraftModel
        ? filterOptions?.aircraft?.find(a => a.code === params.aircraftModel)
        : params.aircraftType
          ? { name: params.aircraftType, type: params.aircraftType }
          : null;

      setExploreContext({ departure: params.departure, aircraft: ac });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Error exploring destinations:', err);
      setError('Explore failed. Please check your connection and try again.');
      setExploreResults([]);
    } finally {
      setLoading(false);
    }
  }, [filterOptions]);

  return {
    flights,
    exploreResults,
    exploreContext,
    loading,
    loadingMessage,
    error,
    apiSource,
    hasSearched,
    searchedAirlines,
    handleSearch,
    handleExplore,
    clearError: () => setError(null),
  };
}

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
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearError = useCallback(() => setError(null), []);

  return { flights, loading, loadingMessage, error, apiSource, hasSearched, clearError };
}

import { useState, useCallback, useRef } from 'react';
import { buildFlightParams } from '../utils/flightUtils';
import { API_BASE } from '../utils/api';

export function useFlightSearch(filterOptions) {
  const [flights, setFlights] = useState([]);
  const [exploreResults, setExploreResults] = useState(null);
  const [exploreContext, setExploreContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [apiSource, setApiSource] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

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
    handleSearch,
    handleExplore,
    clearError: () => setError(null),
  };
}

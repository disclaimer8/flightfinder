import { useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { buildFlightParams } from '../utils/flightUtils';

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
      const response = await axios.get(`/api/flights?${params}`, {
        signal: controller.signal,
      });
      setFlights(response.data.data || []);
      setApiSource(response.data.source);
      setHasSearched(true);
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError') return;
      console.error('Error searching flights:', err);
      const detail = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'unknown';
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

      const response = await axios.get(`/api/flights/explore?${p}`, {
        signal: controller.signal,
      });
      setExploreResults(response.data.data || []);

      const ac = params.aircraftModel
        ? filterOptions?.aircraft?.find(a => a.code === params.aircraftModel)
        : params.aircraftType
          ? { name: params.aircraftType, type: params.aircraftType }
          : null;

      setExploreContext({ departure: params.departure, aircraft: ac });
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError') return;
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

import { useState, useCallback, useRef } from 'react';
import { API_BASE } from '../utils/api';

/**
 * Hook for streaming aircraft-family flight search via SSE.
 *
 * Usage:
 *   const { results, progress, status, error, search, cancel } = useAircraftSearch();
 *   search({ familyName: 'Boeing 737', city: 'London', radius: 150, date: '2026-06-01' });
 */
export function useAircraftSearch() {
  const [results,  setResults]  = useState([]);
  const [progress, setProgress] = useState(null);  // { phase, airports?, completed, total }
  const [status,   setStatus]   = useState('idle'); // idle | searching | done | error
  const [error,    setError]    = useState(null);
  const esRef = useRef(null);

  const cancel = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStatus(s => s === 'searching' ? 'idle' : s);
  }, []);

  const search = useCallback((params) => {
    // Cancel any running search
    cancel();

    setResults([]);
    setProgress(null);
    setError(null);
    setStatus('searching');

    const qs = new URLSearchParams();
    if (params.familyName) qs.set('familyName', params.familyName);
    if (params.city)       qs.set('city',       params.city);
    if (params.iata)       qs.set('iata',        params.iata);
    if (params.radius)     qs.set('radius',      String(params.radius));
    if (params.date)       qs.set('date',        params.date);
    if (params.passengers) qs.set('passengers',  String(params.passengers));
    if (params.nonStop)    qs.set('nonStop',     '1');

    const url = `${API_BASE}/api/flights/aircraft-search/stream?${qs.toString()}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('progress', (e) => {
      try { setProgress(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.addEventListener('result', (e) => {
      try {
        const flight = JSON.parse(e.data);
        setResults(prev => [...prev, flight]);
      } catch { /* ignore */ }
    });

    es.addEventListener('done', (e) => {
      es.close();
      esRef.current = null;
      setStatus('done');
    });

    es.addEventListener('error', (e) => {
      let msg = 'Search failed';
      if (e.data) {
        try { msg = JSON.parse(e.data).message || msg; } catch { /* ignore */ }
      }
      es.close();
      esRef.current = null;
      setError(msg);
      setStatus('error');
    });

    // Handle connection-level errors (network down etc.)
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null;
        setStatus(s => s === 'searching' ? 'error' : s);
        setError(prev => prev || 'Connection lost');
      }
    };
  }, [cancel]);

  const pct = progress?.total
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return { results, progress, pct, status, error, search, cancel };
}

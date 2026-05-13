import { Suspense, lazy, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import RouteMapFilters from './map/RouteMapFilters';
import { fetchRoutes, fetchFilters } from './map/mapApi';
import styles from './map/Map.module.css';

// Lazy-load the Leaflet bundle so it doesn't ship on first paint.
const RouteMapLayer = lazy(() => import('./map/RouteMapLayer'));

export default function Map() {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filter state — driven by URL ─────────────────────────────────────────
  const airline  = searchParams.get('airline')  || null;
  const aircraft = searchParams.get('aircraft') || null;

  // ── Filter options (airlines + aircraft types) ────────────────────────────
  const [filterOpts, setFilterOpts] = useState({ airlines: [], aircraft: [] });

  useEffect(() => {
    fetchFilters()
      .then(opts => setFilterOpts(opts))
      .catch(err => console.warn('Map: fetchFilters error', err.message));
  }, []);

  // ── Route data ────────────────────────────────────────────────────────────
  const [routes,  setRoutes]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchRoutes({ airline, aircraft })
      .then(data => {
        if (!cancelled) {
          setRoutes(data);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.warn('Map: fetchRoutes error', err.message);
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [airline, aircraft]);

  // ── Filter change handler — updates URL params ────────────────────────────
  const handleFilterChange = useCallback(({ airline: a, aircraft: ac }) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (a)  next.set('airline',  a);  else next.delete('airline');
      if (ac) next.set('aircraft', ac); else next.delete('aircraft');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const filters = { airline, aircraft };

  // ── Empty state ────────────────────────────────────────────────────────────
  const isEmpty = !loading && !error && routes.length === 0;

  return (
    <main className={styles.page} data-testid="page-map">
      <h1>Flight route map</h1>

      <RouteMapFilters
        airline={airline}
        aircraft={aircraft}
        airlines={filterOpts.airlines}
        aircraftList={filterOpts.aircraft}
        onChange={handleFilterChange}
      />

      {error && (
        <p className={styles.empty} role="alert">
          Failed to load routes: {error}
        </p>
      )}

      <Suspense fallback={<div className={`${styles.skel} ${styles.mapContainer}`} />}>
        <RouteMapLayer routes={routes} filters={filters} loading={loading} />
      </Suspense>

      {isEmpty && (
        <p className={styles.empty}>
          No routes found for the current filter selection.
        </p>
      )}
    </main>
  );
}

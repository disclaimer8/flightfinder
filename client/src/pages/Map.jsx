import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import SiteLayout from '../components/SiteLayout';
import { fetchRoutes, fetchFilters } from './map/mapApi';
import { enrichAirportsWithDegree, filterByZoom, filterRoutes } from './map/computeMapData';
import RouteMapLayer    from './map/RouteMapLayer';
import AirportLayer     from './map/AirportLayer';
import HeatmapLayer     from './map/HeatmapLayer';
import MapFilters       from './map/MapFilters';
import MapViewToggle    from './map/MapViewToggle';
import AirportPanel     from './map/AirportPanel';
import RoutePopup       from './map/RoutePopup';
import { API_BASE }     from '../utils/api';
import styles from './map/Map.module.css';

async function fetchAirports() {
  const res = await fetch(`${API_BASE}/api/map/airports`);
  if (!res.ok) throw new Error(`airports ${res.status}`);
  const d = await res.json();
  // Server returns compact { pts, crd, names, cities, countries }. Rebuild objects.
  if (Array.isArray(d.pts) && Array.isArray(d.crd)) {
    return d.pts.map((iata, i) => ({
      iata,
      lat: d.crd[i * 2],
      lon: d.crd[i * 2 + 1],
      name: d.names?.[i] || '',
      city: d.cities?.[i] || '',
      country: d.countries?.[i] || '',
    }));
  }
  return [];
}

export default function Map() {
  const [searchParams, setSearchParams] = useSearchParams();
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // ── URL-driven state ──────────────────────────────────────────────────────
  const airline     = searchParams.get('airline')     || null;
  const aircraft    = searchParams.get('aircraft')    || null;
  const view        = searchParams.get('view') === 'density' ? 'density' : 'network';
  const selectedIata = searchParams.get('selected')   || null;
  const routePair   = searchParams.get('route') || null;
  const [routePopupDep, routePopupArr] = routePair ? routePair.split('-') : [null, null];

  // ── Data fetches ─────────────────────────────────────────────────────────
  const [routes,   setRoutes]   = useState([]);
  const [airports, setAirports] = useState([]);
  const [filterOpts, setFilterOpts] = useState({ airlines: [], aircraft: [] });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [zoom, setZoom] = useState(2);

  useEffect(() => {
    fetchFilters().then(setFilterOpts).catch(() => {});
    fetchAirports().then(setAirports).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetchRoutes({ airline, aircraft })
      .then(data => { if (!cancelled) { setRoutes(data); setLoading(false); } })
      .catch(err  => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [airline, aircraft]);

  // ── Map init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;
    let cancelled = false;
    (async () => {
      const Lmod = await import('leaflet');
      const L = Lmod.default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, {
        center: [20, 0],
        zoom: 2,
        worldCopyJump: true,
        preferCanvas: true,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://carto.com">CARTO</a> | Safety data: Aviation Safety Network, B3A, Wikidata',
        subdomains: 'abcd',
        maxZoom: 10,
      }).addTo(map);
      // Defer invalidateSize past initial paint so Leaflet measures the container
      // AFTER browser layout settles. Without this Leaflet snapshots a stale (often
      // smaller) container size and tiles render in a tiny region of the page.
      requestAnimationFrame(() => map.invalidateSize());
      // Also re-measure on container resize (sidebar open/close, window resize, etc).
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(containerRef.current);
      mapRef.current = map;
      mapRef._resizeObserver = ro;
      map.on('zoomend', () => setZoom(map.getZoom()));
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef._resizeObserver) {
        mapRef._resizeObserver.disconnect();
        mapRef._resizeObserver = null;
      }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────
  const airportsWithDegree = useMemo(
    () => (airports.length ? enrichAirportsWithDegree(airports, routes) : []),
    [airports, routes],
  );

  // Zoom-aware visible airport set — top 200 at z≤3, top 1000 at z≤5, all at z≥6.
  const visibleAirports = useMemo(
    () => filterByZoom(airportsWithDegree, zoom),
    [airportsWithDegree, zoom],
  );
  const visibleIatas = useMemo(
    () => new Set(visibleAirports.map(a => a.iata)),
    [visibleAirports],
  );

  // Routes culled to only those between visible airports (criterion #1).
  const visibleRoutes = useMemo(
    () => filterRoutes(routes, { airline, aircraft }, visibleIatas),
    [routes, airline, aircraft, visibleIatas],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const updateFilters = useCallback(({ airline: a, aircraft: ac }) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (a)  next.set('airline',  a);  else next.delete('airline');
      if (ac) next.set('aircraft', ac); else next.delete('aircraft');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const updateView = useCallback((v) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (v === 'density') next.set('view', 'density'); else next.delete('view');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const selectAirport = useCallback((iata) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (iata) next.set('selected', iata); else next.delete('selected');
      next.delete('route');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closeAirport = useCallback(() => selectAirport(null), [selectAirport]);

  const selectRoute = useCallback((dep, arr) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('route', `${dep}-${arr}`);
      next.delete('selected'); // mutually exclusive with airport panel
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closeRoutePopup = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('route');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const selectedAirport = selectedIata
    ? airports.find(a => a.iata === selectedIata) || { iata: selectedIata }
    : null;

  return (
    <SiteLayout>
      <div className={styles.page} data-testid="page-map">
        <h1 style={{ position: 'absolute', left: '-9999px' }}>Flight route map</h1>

        <div ref={containerRef} className={styles.mapContainer} aria-label="Flight route map" />

        {mapReady && (
          <>
            {view === 'network' && (
              <AirportLayer
                mapRef={mapRef}
                airports={visibleAirports}
                onSelect={selectAirport}
                selectedIata={selectedIata}
              />
            )}
            {view === 'density' && (
              <HeatmapLayer mapRef={mapRef} routes={routes} />
            )}
            <RouteMapLayer
              mapRef={mapRef}
              routes={visibleRoutes}
              filters={{ airline, aircraft }}
              loading={loading}
              selectedIata={selectedIata}
              onRouteClick={selectRoute}
            />
          </>
        )}

        <MapFilters
          airline={airline}
          aircraft={aircraft}
          options={filterOpts}
          onChange={updateFilters}
        />

        <MapViewToggle value={view} onChange={updateView} />

        {error && (
          <div className={styles.empty} role="alert">Failed to load routes: {error}</div>
        )}

        {loading && (
          <div className={styles.mapOverlay} aria-live="polite">Loading map…</div>
        )}

        {selectedAirport && (
          <AirportPanel
            airport={selectedAirport}
            routes={routes}
            onClose={closeAirport}
          />
        )}

        {routePopupDep && routePopupArr && (
          <RoutePopup dep={routePopupDep} arr={routePopupArr} onClose={closeRoutePopup} />
        )}
      </div>
    </SiteLayout>
  );
}

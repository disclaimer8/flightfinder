import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import styles from './Map.module.css';

/**
 * RouteMapLayer — Leaflet canvas-rendered polylines for observed routes.
 *
 * Props:
 *   routes   Array<{dep:{iata,lat,lon}, arr:{iata,lat,lon}, airline_count, aircraft_count}>
 *   filters  {airline: string|null, aircraft: string|null}
 *   loading  boolean
 */
export default function RouteMapLayer({ routes, filters, loading }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const layerRef     = useRef(null);
  const LRef         = useRef(null);
  const navigate     = useNavigate();

  // Stash navigate in a ref so polyline click handlers don't need to rebind
  // every time the routes array changes.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Signals that the Leaflet map has been created and is ready to receive
  // layers. Stored in state (not just a ref) so the data effect re-runs
  // automatically after the async init completes.
  const [mapReady, setMapReady] = useState(false);

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;
    let cancelled = false;
    let map = null;

    (async () => {
      if (!LRef.current) LRef.current = await import('leaflet');
      if (cancelled || !containerRef.current || mapRef.current) return;

      const L = LRef.current.default;

      map = L.map(containerRef.current, {
        center: [20, 0],
        zoom: 2,
        worldCopyJump: true,
        preferCanvas: true,
        zoomControl: true,
        attributionControl: true,
      });
      mapRef.current = map;
      // Safety net: force Leaflet to re-measure the container in case it was
      // 0-height at mount time (common in flex layouts before paint).
      map.invalidateSize();

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution:
          '© <a href="https://carto.com">CARTO</a> | Safety data: Aviation Safety Network, B3A, Wikidata',
        subdomains: 'abcd',
        maxZoom: 8,
      }).addTo(map);

      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      if (map) {
        map.remove();
        if (mapRef.current === map) mapRef.current = null;
      }
    };
  }, []);

  // ── Re-render routes when data changes ────────────────────────────────────
  // Depends on mapReady so it re-runs once the async init completes.
  useEffect(() => {
    if (!mapReady) return;

    let cancelled = false;

    async function render() {
      // L is already cached in LRef by the init effect (both share the ref).
      // On the very first run LRef may still be null in theory, but in practice
      // mapReady=true is only set after the init effect has set LRef.current.
      // We await here as a safety net; on repeat renders it resolves instantly.
      if (!LRef.current) LRef.current = await import('leaflet');
      if (cancelled) return;

      const map = mapRef.current;
      if (!map) return;

      const L = LRef.current.default;

      // Remove old layer synchronously — L is already cached so there is no
      // microtask gap where stale polylines remain interactive.
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }

      if (!Array.isArray(routes) || routes.length === 0) return;

      const renderer = L.canvas({ padding: 0.5 });
      const group = L.layerGroup();

      for (const r of routes) {
        if (!r.dep || !r.arr) continue;

        const [dep, arr] = adjustForAntimeridian(r.dep, r.arr);

        const line = L.polyline(
          [[dep.lat, dep.lon], [arr.lat, arr.lon]],
          {
            color: '#3b82f6',
            weight: 1.5,
            opacity: 0.15,
            renderer,
            interactive: true,
          }
        );

        line.bindTooltip(formatTooltip(r, filters), { sticky: true });

        line.on('mouseover', () => line.setStyle({ weight: 4, opacity: 0.9 }));
        line.on('mouseout',  () => line.setStyle({ weight: 1.5, opacity: 0.15 }));
        line.on('click', () => {
          navigateRef.current(
            `/search?from=${encodeURIComponent(r.dep.iata)}&to=${encodeURIComponent(r.arr.iata)}`
          );
        });

        line.addTo(group);
      }

      group.addTo(map);
      layerRef.current = group;
    }

    render();
    return () => { cancelled = true; };
  }, [mapReady, routes, filters]);

  return (
    <div className={styles.mapWrap}>
      <div
        ref={containerRef}
        className={styles.mapContainer}
        aria-label="Flight route map"
      />
      {loading && (
        <div className={`${styles.skel} ${styles.mapOverlay}`} aria-live="polite">
          Loading map…
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * If |dep.lon - arr.lon| > 180 degrees we are crossing the antimeridian.
 * Shift arr.lon by ±360 so Leaflet draws the shorter arc rather than the
 * long westward sweep across the whole map.
 */
function adjustForAntimeridian(dep, arr) {
  const dlon = arr.lon - dep.lon;
  if (Math.abs(dlon) <= 180) return [dep, arr];
  const shift = dlon > 0 ? -360 : 360;
  return [dep, { ...arr, lon: arr.lon + shift }];
}

function formatTooltip(r, filters) {
  const parts = [`${r.dep.iata} → ${r.arr.iata}`];

  if (filters && (filters.airline || filters.aircraft)) {
    if (filters.airline)  parts.push(filters.airline);
    if (filters.aircraft) parts.push(filters.aircraft);
  } else {
    const ac = r.airline_count ?? 0;
    const tc = r.aircraft_count ?? 0;
    parts.push(`${ac} airline${ac === 1 ? '' : 's'}`);
    parts.push(`${tc} aircraft type${tc === 1 ? '' : 's'}`);
  }

  return parts.join(' · ');
}

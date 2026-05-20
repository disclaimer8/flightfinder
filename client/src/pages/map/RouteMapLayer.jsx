import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * RouteMapLayer — Leaflet canvas-rendered polylines for observed routes.
 *
 * Renders nothing in React DOM. Adds a polyline layerGroup to the parent
 * map via mapRef.
 *
 * Props:
 *   mapRef       {current: L.Map | null} — required
 *   routes       Array<{dep:{iata,lat,lon}, arr:{iata,lat,lon}, airline_count, aircraft_count}>
 *   filters      {airline: string|null, aircraft: string|null}
 *   loading      boolean (unused now — loading overlay is owned by Map.jsx)
 *   selectedIata string|null — when set, routes touching this iata highlight amber
 *   interactive  boolean (default true) — false makes polylines pass-through for
 *                pointer events, so hover-preview spokes don't steal the marker's
 *                hover state. Only true when the user has pinned a selection.
 *   onRouteClick (dep: string, arr: string) => void  — optional; falls back to navigate
 */
export default function RouteMapLayer({ mapRef, routes, filters, loading, selectedIata, interactive = true, onRouteClick }) {
  const layerRef = useRef(null);
  const LRef     = useRef(null);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const onRouteClickRef = useRef(onRouteClick);
  onRouteClickRef.current = onRouteClick;

  useEffect(() => {
    const map = mapRef?.current;
    if (!map) return;
    let cancelled = false;

    async function render() {
      if (!LRef.current) LRef.current = await import('leaflet');
      if (cancelled) return;
      const L = LRef.current.default;

      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }

      if (!Array.isArray(routes) || routes.length === 0) return;
      // Click-to-reveal model: only render routes when an airport is hovered
      // or pinned (selectedIata). Default state shows airport dots only.
      if (!selectedIata) return;

      const renderer = L.canvas({ padding: 0.5 });
      const group = L.layerGroup();

      for (const r of routes) {
        if (!r.dep || !r.arr) continue;

        // Skip non-spokes entirely — no faint background lines.
        const isSpoke = r.dep?.iata === selectedIata || r.arr?.iata === selectedIata;
        if (!isSpoke) continue;

        const [dep, arr] = adjustForAntimeridian(r.dep, r.arr);

        const color   = '#f59e0b';
        const opacity = 0.85;
        const weight  = 2.5;

        const line = L.polyline(
          [[dep.lat, dep.lon], [arr.lat, arr.lon]],
          { color, weight, opacity, renderer, interactive },
        );

        if (interactive) {
          line.bindTooltip(formatTooltip(r, filters), { sticky: true });
          line.on('mouseover', () => line.setStyle({ weight: 4, opacity: Math.max(opacity, 0.9) }));
          line.on('mouseout',  () => line.setStyle({ weight, opacity }));
          line.on('click', () => {
            if (onRouteClickRef.current) {
              onRouteClickRef.current(r.dep.iata, r.arr.iata);
            } else {
              navigateRef.current(
                `/search?from=${encodeURIComponent(r.dep.iata)}&to=${encodeURIComponent(r.arr.iata)}`,
              );
            }
          });
        }

        line.addTo(group);
      }

      group.addTo(map);
      layerRef.current = group;

      // When polylines are decorative (hover-preview, not clickable), drop
      // pointer-events on the underlying canvas so mouseover/click pass through
      // to the airport-marker layer below. Leaflet's per-path `interactive:false`
      // only skips hit-testing — the canvas DOM still captures the events without
      // this CSS override, causing the airport marker's hover state to break.
      if (renderer._container) {
        renderer._container.style.pointerEvents = interactive ? '' : 'none';
      }
    }

    render();

    return () => {
      cancelled = true;
      if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
    };
  }, [mapRef, routes, filters, selectedIata, interactive]);

  return null;
}

// ── Helpers (unchanged from previous version) ──────────────────────────────

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

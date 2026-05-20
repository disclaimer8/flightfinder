import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat'; // attaches L.heatLayer

/**
 * Leaflet.heat density layer. Builds weighted points from route endpoints.
 *
 * Props:
 *   mapRef  {current: L.Map | null}
 *   routes  Array<{dep:{lat,lon}, arr:{lat,lon}, airline_count?, aircraft_count?}>
 */
export default function HeatmapLayer({ mapRef, routes }) {
  const layerRef = useRef(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }

    if (!Array.isArray(routes) || routes.length === 0) return;

    const points = [];
    for (const r of routes) {
      const w = Math.log1p((r.airline_count || 1) + (r.aircraft_count || 0));
      if (Number.isFinite(r.dep?.lat) && Number.isFinite(r.dep?.lon)) {
        points.push([r.dep.lat, r.dep.lon, w]);
      }
      if (Number.isFinite(r.arr?.lat) && Number.isFinite(r.arr?.lon)) {
        points.push([r.arr.lat, r.arr.lon, w]);
      }
    }

    const heat = L.heatLayer(points, {
      radius: 22,
      blur: 18,
      maxZoom: 5,        // fade out at zoom 5+, leaving Network layer dominant
      max: 3.0,          // scale ceiling for weight normalization
      gradient: { 0.2: '#3b82f6', 0.5: '#f59e0b', 0.85: '#ef4444' },
    });
    heat.addTo(map);
    layerRef.current = heat;

    return () => {
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
    };
  }, [mapRef, routes]);

  return null;
}

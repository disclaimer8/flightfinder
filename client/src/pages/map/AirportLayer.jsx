import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { filterByZoom } from './computeMapData';

const SELECTED_COLOR = '#f59e0b';
const DEFAULT_COLOR  = '#60a5fa';

/**
 * Scale: degree → marker radius in pixels.
 * Clamp to [3, 14] so a runaway degree value doesn't produce a 50px blob.
 */
function radiusForDegree(d) {
  const clamped = Math.max(1, Math.min(500, d || 1));
  // Square-root scale so degree=200 (top hub) is ~14, degree=1 is ~3.
  return Math.round(3 + Math.sqrt(clamped) * 0.78);
}

/**
 * Leaflet airport-dot layer. Renders nothing in the React tree — adds
 * circleMarkers to the parent map directly via mapRef.
 *
 * Props:
 *   mapRef       {current: L.Map | null}
 *   airports     Array<{iata,name,city,country,lat,lon,degree}>
 *   onSelect     (iata: string) => void
 *   selectedIata string | null   — visually highlighted dot
 */
export default function AirportLayer({ mapRef, airports, onSelect, selectedIata }) {
  const groupRef = useRef(null);
  const [zoom, setZoom] = useState(() => mapRef.current?.getZoom?.() ?? 2);

  // Track zoom changes to re-cull visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.on) return;
    const handler = () => setZoom(map.getZoom());
    map.on('zoomend', handler);
    return () => { map.off?.('zoomend', handler); };
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous layer
    if (groupRef.current) {
      groupRef.current.remove();
      groupRef.current = null;
    }

    const visible = filterByZoom(airports, zoom);
    const group = L.layerGroup();
    for (const a of visible) {
      const isSel = selectedIata && a.iata === selectedIata;
      const marker = L.circleMarker([a.lat, a.lon], {
        radius: radiusForDegree(a.degree) * (isSel ? 1.3 : 1),
        color: isSel ? SELECTED_COLOR : DEFAULT_COLOR,
        fillColor: isSel ? SELECTED_COLOR : DEFAULT_COLOR,
        fillOpacity: 0.7,
        weight: isSel ? 2 : 1,
        _iata: a.iata, // test seam
      });
      marker.bindTooltip(`${a.iata}${a.name ? ' — ' + a.name : ''}`, { direction: 'top' });
      marker.on('click', () => onSelect(a.iata));
      marker.addTo(group);
    }
    group.addTo(map);
    groupRef.current = group;

    return () => {
      if (groupRef.current) {
        groupRef.current.remove();
        groupRef.current = null;
      }
    };
  }, [mapRef, airports, zoom, selectedIata, onSelect]);

  return null;
}

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { filterByZoom } from './computeMapData';

const SELECTED_COLOR = '#f59e0b';
const DEFAULT_COLOR  = '#60a5fa';

/**
 * Scale: degree → marker radius in pixels.
 * Range ~[5, 11]. Trade-off:
 *   - 18px hubs at z=2 sat on top of nearby airports (MAD-LIS ~16px apart
 *     horizontally; bigger hub radius makes the neighbor unclickable).
 *   - 5px minimum is the smallest comfortable hit target without zooming.
 * Users zoom in for fine-grained cluster picking; this scale keeps dense
 * regions (Iberia, Northeast US, SE Asia) navigable at world view.
 */
function radiusForDegree(d) {
  const clamped = Math.max(1, Math.min(500, d || 1));
  return Math.round(5 + Math.sqrt(clamped) * 0.45);
}

/**
 * Leaflet airport-dot layer. Renders nothing in the React tree — adds
 * circleMarkers to the parent map directly via mapRef.
 *
 * Props:
 *   mapRef       {current: L.Map | null}
 *   airports     Array<{iata,name,city,country,lat,lon,degree}>
 *   onSelect     (iata: string) => void
 *   onHover      (iata: string | null) => void  — optional; emits on mouseover/mouseout
 *   selectedIata string | null   — visually highlighted dot (pinned via URL)
 */
export default function AirportLayer({ mapRef, airports, onSelect, onHover, selectedIata }) {
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

    // filterByZoom returns top-K sorted by degree DESC. We iterate in REVERSE
    // (smallest first → drawn first → biggest last) so big hub dots end up
    // ON TOP for both visual layering and Leaflet's canvas hit-test. Without
    // this reversal, small airports drawn after big ones cover them and the
    // hit-test returns the small neighbor even when the user clicks the big hub.
    const visible = filterByZoom(airports, zoom).slice().reverse();
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
      if (onHover) {
        marker.on('mouseover', () => onHover(a.iata));
        marker.on('mouseout',  () => onHover(null));
      }
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
  }, [mapRef, airports, zoom, selectedIata, onSelect, onHover]);

  return null;
}

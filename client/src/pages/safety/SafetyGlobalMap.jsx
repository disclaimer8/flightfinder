import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

/**
 * SafetyGlobalMap — Leaflet view of geocoded accident points.
 *
 * Why no marker-clustering library:
 *   leaflet.markercluster ships ~25KB JS + 4KB CSS minified. We render raw
 *   points on a shared L.canvas() renderer: one canvas, one DOM node,
 *   948 circleMarkers stay smooth even on mid-tier phones. We give up the
 *   visual "N events here" badges, but per-point severity colour is more
 *   informative at our scale.
 *
 * Props:
 *   points       Array<{id, model, fatalities, year, lat, lon}>
 *   selectedId   number | null  — highlights one marker
 *   onSelect     (id) => void   — fired on marker click (canvas hit-test)
 */
export default function SafetyGlobalMap({ points, selectedId, onSelect }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const layerRef     = useRef(null);
  const markerByIdRef = useRef(new Map()); // id → circleMarker for selected-state restyling

  // Touch devices need a larger tap target than the visible 3-4px circle.
  // Stash the latest onSelect in a ref so the click handler doesn't have to
  // re-bind every render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Init map once.
  useEffect(() => {
    if (mapRef.current) return;
    let cancelled = false;
    let map = null;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      map = L.map(containerRef.current, {
        center: [20, 0],
        zoom: 2,
        worldCopyJump: true,
        preferCanvas: true,
        zoomControl: true,
        attributionControl: true,
      });
      mapRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution:
          '© <a href="https://carto.com">CARTO</a> | Safety data: Aviation Safety Network, B3A, Wikidata',
        subdomains: 'abcd',
        maxZoom: 12,
      }).addTo(map);
    })();

    return () => {
      cancelled = true;
      if (map) {
        map.remove();
        if (mapRef.current === map) mapRef.current = null;
      }
    };
  }, []);

  // Re-render markers whenever the (already-filtered) points array changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = mapRef.current;
      if (!map || !Array.isArray(points)) return;
      const L = (await import('leaflet')).default;
      if (cancelled || !mapRef.current) return;

      // Tear down previous layer.
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
      markerByIdRef.current.clear();

      const renderer = L.canvas({ padding: 0.5 });
      const group = L.layerGroup();

      // Bump radius on coarse pointers (touch). The Leaflet circleMarker hit
      // test works on the actual painted radius, so a bigger circle is also
      // a bigger tap target without an extra invisible halo layer.
      const isCoarse = window.matchMedia?.('(pointer: coarse)').matches;
      const baseRadius = isCoarse ? 6 : 3;

      for (const p of points) {
        if (!p || (p.lat === 0 && p.lon === 0)) continue;
        const fatalCount = parseInt(p.fatalities, 10);
        const isFatal = !isNaN(fatalCount) && fatalCount > 0;

        const m = L.circleMarker([p.lat, p.lon], {
          renderer,
          radius: isFatal ? baseRadius + 1 : baseRadius,
          color: isFatal ? '#dc2626' : '#f59e0b',
          fillColor: isFatal ? '#ef4444' : '#fbbf24',
          fillOpacity: 0.6,
          weight: 1,
          opacity: 0.85,
          interactive: true,
        });

        // Tooltip only on devices that support hover; touch devices skip
        // straight to click → side panel.
        if (!isCoarse) {
          const fatalLabel = (p.fatalities && p.fatalities !== 'Unknown' && p.fatalities !== '0')
            ? `${p.fatalities} fatalities`
            : 'no fatalities reported';
          const yearLabel = p.year ? ` · ${p.year}` : '';
          m.bindTooltip(`${p.model || 'Unknown aircraft'}${yearLabel} — ${fatalLabel}`, {
            direction: 'top',
            offset: [0, -baseRadius],
          });
        }

        m.on('click', () => {
          if (onSelectRef.current) onSelectRef.current(p.id);
        });

        markerByIdRef.current.set(p.id, m);
        group.addLayer(m);
      }

      group.addTo(map);
      layerRef.current = group;
    })();

    return () => { cancelled = true; };
  }, [points]);

  // Restyle the selected marker (white stroke + bigger radius). Done as a
  // separate effect so we don't redraw all markers when only the selection
  // changes — that would lose pan/zoom state.
  useEffect(() => {
    const allMarkers = markerByIdRef.current;
    if (!allMarkers.size) return;
    for (const [id, marker] of allMarkers) {
      const isSel = id === selectedId;
      const opts = marker.options;
      marker.setStyle({
        radius: isSel ? opts.radius + 3 : opts.radius,
        weight: isSel ? 3 : 1,
        color: isSel ? '#ffffff' : opts.color,
      });
      // Force the canvas to repaint without clearing pan/zoom.
      if (marker.bringToFront && isSel) marker.bringToFront();
    }
  }, [selectedId, points]);

  return <div ref={containerRef} className="safety-global__map" />;
}

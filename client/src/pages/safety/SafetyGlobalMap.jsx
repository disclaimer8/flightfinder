import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

/**
 * SafetyGlobalMap — Leaflet view of all geocoded accident points.
 *
 * Why no marker-clustering library:
 *   leaflet.markercluster ships ~25KB JS + 4KB CSS minified. We can keep the
 *   bundle lean by rendering raw points on a shared L.canvas() renderer:
 *   one canvas, one DOM node, ~10K circleMarkers stay smooth even on mid-tier
 *   phones. We give up the visual "N events here" badges, but tooltips on
 *   each point still work and cluster overlap is acceptable at world zoom.
 *
 * Props:
 *   points: Array<{id, model, fatalities, lat, lon}>
 */
export default function SafetyGlobalMap({ points }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const layerRef     = useRef(null);

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

  // Re-render markers whenever the points array changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = mapRef.current;
      if (!map || !Array.isArray(points)) return;
      const L = (await import('leaflet')).default;
      if (cancelled || !mapRef.current) return;

      // Tear down previous layer
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }

      // Single canvas renderer shared by every marker — cheap for 10K points.
      const renderer = L.canvas({ padding: 0.5 });
      const group = L.layerGroup();

      for (const p of points) {
        if (!p || (p.lat === 0 && p.lon === 0)) continue;
        const fatalCount = parseInt(p.fatalities, 10);
        const isFatal = !isNaN(fatalCount) && fatalCount > 0;

        const m = L.circleMarker([p.lat, p.lon], {
          renderer,
          radius: isFatal ? 4 : 3,
          color: isFatal ? '#dc2626' : '#f59e0b',
          fillColor: isFatal ? '#ef4444' : '#fbbf24',
          fillOpacity: 0.6,
          weight: 1,
          opacity: 0.85,
        });

        const fatalLabel =
          (p.fatalities && p.fatalities !== 'Unknown' && p.fatalities !== '0')
            ? `${p.fatalities} fatalities`
            : 'no fatalities reported';
        m.bindTooltip(`${p.model || 'Unknown aircraft'} — ${fatalLabel}`, {
          direction: 'top',
        });
        group.addLayer(m);
      }

      group.addTo(map);
      layerRef.current = group;
    })();

    return () => { cancelled = true; };
  }, [points]);

  return <div ref={containerRef} className="safety-global__map" />;
}

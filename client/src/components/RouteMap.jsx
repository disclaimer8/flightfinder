import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import './RouteMap.css';
import ValidityCalendar from './ValidityCalendar';

// ── Haversine great-circle distance (km) ────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Route arc colours by confidence tier ────────────────────────────────────
const ARC_STYLE = {
  live:       { color: 'rgba(52,211,153,0.85)',  weight: 2.0, dashArray: null },
  scheduled:  { color: 'rgba(99,140,200,0.55)',  weight: 1.5, dashArray: null },
  observed:   { color: 'rgba(180,130,200,0.40)', weight: 1.2, dashArray: '4 3' },
};

// ── Great-circle intermediate points (for geodesic arcs) ────────────────────
function geodesicPoints(lat1, lon1, lat2, lon2, steps = 80) {
  const rad = x => x * Math.PI / 180;
  const deg = x => x * 180 / Math.PI;
  const φ1 = rad(lat1), λ1 = rad(lon1);
  const φ2 = rad(lat2), λ2 = rad(lon2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));
  if (d < 0.001) return [[lat1, lon1], [lat2, lon2]];
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push([deg(Math.atan2(z, Math.sqrt(x ** 2 + y ** 2))), deg(Math.atan2(y, x))]);
  }
  return pts;
}

// ── Canvas airport-dot layer ─────────────────────────────────────────────────
function mountAirportCanvas(map, airports, refs) {
  const pane = map.getPanes().overlayPane;
  const canvas = document.createElement('canvas');
  canvas.className = 'rm-airport-canvas';
  pane.appendChild(canvas);

  const redraw = () => {
    if (!map || !canvas) return;
    const size = map.getSize();
    canvas.width  = size.x;
    canvas.height = size.y;
    const tl = map.containerPointToLayerPoint([0, 0]);
    canvas.style.transform = `translate(${tl.x}px,${tl.y}px)`;

    const ctx  = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.x, size.y);
    const zoom = map.getZoom();
    const rDef = zoom >= 9 ? 4 : zoom >= 6 ? 3 : 2;

    const sel   = refs.selected.current;
    const high  = refs.highlighted.current;
    const inRad = refs.inRadius.current;

    for (let i = 0; i < airports.pts.length; i++) {
      const lat = airports.crd[i * 2];
      const lon = airports.crd[i * 2 + 1];
      const pt  = map.latLngToContainerPoint([lat, lon]);
      if (pt.x < -10 || pt.x > size.x + 10 || pt.y < -10 || pt.y > size.y + 10) continue;

      const iata   = airports.pts[i];
      const isSel  = iata === sel;
      const isHigh = high.has(iata);
      const isInR  = inRad.has(iata);
      const r      = isSel ? 7 : isHigh ? 5 : isInR ? 4 : rDef;

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isSel
        ? '#6c8eff'
        : isHigh ? '#a78bfa'
        : isInR  ? '#34d399'
        : 'rgba(255,255,255,0.28)';
      ctx.fill();

      if (isSel || isHigh) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = isSel ? 'rgba(108,142,255,0.45)' : 'rgba(167,139,250,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  };

  map.on('move zoom viewreset resize', redraw);
  redraw();

  const hitTest = (containerPt, tol = 12) => {
    let best = null, bestD = tol;
    for (let i = 0; i < airports.pts.length; i++) {
      const lat = airports.crd[i * 2];
      const lon = airports.crd[i * 2 + 1];
      const pt  = map.latLngToContainerPoint([lat, lon]);
      const d   = Math.hypot(pt.x - containerPt.x, pt.y - containerPt.y);
      if (d < bestD) {
        bestD = d;
        best = {
          iata:    airports.pts[i],
          lat,
          lon,
          name:    airports.names[i],
          city:    airports.cities[i],
          country: airports.countries[i],
        };
      }
    }
    return best;
  };

  return {
    canvas,
    redraw,
    hitTest,
    remove: () => {
      map.off('move zoom viewreset resize', redraw);
      canvas.remove();
    },
  };
}

// ── Component ────────────────────────────────────────────────────────────────

// radiusMode: 'off' | 'settingCenter' | 'active'
const DEFAULT_RADIUS = 300;

export default function RouteMap() {
  const containerRef   = useRef(null);
  const mapRef         = useRef(null);
  const canvasLayerRef = useRef(null);

  const airportsDataRef = useRef(null);

  const [selectedOrigin, setSelectedOriginState] = useState(null);
  const selectedRef = useRef(null);

  const [routes, setRoutes]               = useState(null);
  const routesRef                         = useRef(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError]     = useState(null);

  const highlightedRef = useRef(new Set());
  const inRadiusRef    = useRef(new Set());
  const routeLinesRef  = useRef([]);

  // Radius — tap-to-set-center + slider (works on mobile)
  const [radiusMode, setRadiusMode]     = useState('off');  // 'off' | 'settingCenter' | 'active'
  const radiusModeRef                   = useRef('off');
  const [radiusKm, setRadiusKm]         = useState(DEFAULT_RADIUS);
  const radiusKmRef                     = useRef(DEFAULT_RADIUS);
  const radiusCenterRef                 = useRef(null);   // { lat, lng, city }
  const radiusCircleRef                 = useRef(null);   // L.circle instance
  const [radiusCount, setRadiusCount]   = useState(0);

  const [calendarRoute, setCalendarRoute] = useState(null);

  const selectedAirportRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { radiusModeRef.current = radiusMode; }, [radiusMode]);
  useEffect(() => { radiusKmRef.current   = radiusKm;   }, [radiusKm]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const setSelectedOrigin = (ap) => {
    selectedRef.current = ap?.iata ?? null;
    setSelectedOriginState(ap);
  };

  const redrawCanvas = () => canvasLayerRef.current?.redraw();

  const clearRouteLines = () => {
    routeLinesRef.current.forEach(l => l.remove());
    routeLinesRef.current = [];
  };

  const clearRadius = () => {
    radiusCircleRef.current?.remove();
    radiusCircleRef.current = null;
    radiusCenterRef.current = null;
    inRadiusRef.current = new Set();
    setRadiusMode('off');
    setRadiusCount(0);
    redrawCanvas();
  };

  const clearAll = () => {
    clearRouteLines();
    clearRadius();
    setSelectedOrigin(null);
    setRoutes(null);
    routesRef.current = null;
    highlightedRef.current = new Set();
    setRoutesError(null);
    redrawCanvas();
  };

  // ── Update radius circle + airport highlights when km changes ────────────

  const applyRadius = (center, km) => {
    const map = mapRef.current;
    if (!map || !center) return;

    // Update or create circle
    if (radiusCircleRef.current) {
      radiusCircleRef.current.setLatLng([center.lat, center.lng]);
      radiusCircleRef.current.setRadius(km * 1000);
    }

    // Find airports in radius client-side (no round-trip needed)
    const airports = airportsDataRef.current;
    if (!airports) return;
    const inR = new Set();
    for (let i = 0; i < airports.pts.length; i++) {
      const lat = airports.crd[i * 2];
      const lon = airports.crd[i * 2 + 1];
      if (haversineKm(center.lat, center.lng, lat, lon) <= km) {
        inR.add(airports.pts[i]);
      }
    }
    inRadiusRef.current = inR;
    setRadiusCount(inR.size);
    redrawCanvas();
  };

  // Re-apply when slider moves
  useEffect(() => {
    if (radiusMode !== 'active' || !radiusCenterRef.current) return;
    applyRadius(radiusCenterRef.current, radiusKm);
  }, [radiusKm, radiusMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load routes for a clicked airport ────────────────────────────────────

  const loadRoutes = async (ap) => {
    setRoutesLoading(true);
    setRoutesError(null);
    clearRouteLines();
    highlightedRef.current = new Set();

    try {
      const res  = await fetch(`/api/map/routes?origin=${ap.iata}`);
      const data = await res.json();

      if (!res.ok) {
        const msg = data?.error || 'Failed to fetch routes';
        throw new Error(msg);
      }

      setRoutes(data);
      routesRef.current = data;
      highlightedRef.current = new Set(data.destinations);

      const map = mapRef.current;
      const L   = (await import('leaflet')).default;
      for (const destIata of data.destinations) {
        const confidence = data.confidences?.[destIata] ?? 'scheduled';

        const idx = airportsDataRef.current?.pts.indexOf(destIata);
        if (idx === -1 || idx == null) continue;
        const dLat = airportsDataRef.current.crd[idx * 2];
        const dLon = airportsDataRef.current.crd[idx * 2 + 1];
        const pts  = geodesicPoints(ap.lat, ap.lon, dLat, dLon);
        const style = ARC_STYLE[confidence] ?? ARC_STYLE.scheduled;
        const line = L.polyline(pts, {
          color:       style.color,
          weight:      style.weight,
          dashArray:   style.dashArray,
          interactive: false,
        }).addTo(map);
        routeLinesRef.current.push(line);
      }
    } catch (err) {
      setRoutesError(err.message);
    } finally {
      setRoutesLoading(false);
      redrawCanvas();
    }
  };

  // ── Map click handler ─────────────────────────────────────────────────────

  const handleMapClick = (e) => {
    const mode = radiusModeRef.current;

    // ── Radius: setting center ──
    if (mode === 'settingCenter') {
      const { lat, lng } = e.latlng;

      // Find nearest airport name for label
      const layer   = canvasLayerRef.current;
      const nearest = layer?.hitTest(e.containerPoint, 30);
      const city    = nearest?.city || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;

      radiusCenterRef.current = { lat, lng, city };

      // Draw the initial circle
      import('leaflet').then(({ default: L }) => {
        radiusCircleRef.current?.remove();
        radiusCircleRef.current = L.circle([lat, lng], {
          radius:      radiusKmRef.current * 1000,
          color:       '#34d399',
          fillColor:   '#34d399',
          fillOpacity: 0.08,
          weight:      2,
          dashArray:   '6 4',
          interactive: false,
        }).addTo(mapRef.current);

        setRadiusMode('active');
        applyRadius({ lat, lng }, radiusKmRef.current);
      });
      return;
    }

    // ── Normal mode: airport selection ──
    if (mode !== 'off') return;

    const layer = canvasLayerRef.current;
    if (!layer) return;

    const ap = layer.hitTest(e.containerPoint);
    if (!ap) {
      clearAll();
      return;
    }

    // Clicked a highlighted destination → open validity calendar
    if (routesRef.current?.destinations?.includes(ap.iata) && selectedRef.current) {
      const originIata = selectedRef.current;
      const originIdx  = airportsDataRef.current?.pts.indexOf(originIata) ?? -1;
      setCalendarRoute({
        origin: { iata: originIata, city: originIdx >= 0 ? airportsDataRef.current.cities[originIdx] : originIata },
        dest:   { iata: ap.iata, city: ap.city || ap.iata },
      });
      return;
    }

    // Select as new origin
    clearRouteLines();
    clearRadius();
    highlightedRef.current = new Set();
    routesRef.current = null;
    setRoutes(null);
    setRoutesError(null);
    setSelectedOrigin(ap);
    redrawCanvas();
    selectedAirportRef.current = ap;
    loadRoutes(ap);
  };

  // ── Leaflet init ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (mapRef.current) return;

    let map;
    let layer;

    (async () => {
      const L = (await import('leaflet')).default;

      map = L.map(containerRef.current, {
        center: [20, 0],
        zoom:   2,
        worldCopyJump: true,
      });
      mapRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://carto.com">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      const res      = await fetch('/api/map/airports');
      const airports = await res.json();
      airportsDataRef.current = airports;

      layer = mountAirportCanvas(map, airports, {
        selected:    selectedRef,
        highlighted: highlightedRef,
        inRadius:    inRadiusRef,
      });
      canvasLayerRef.current = layer;

      map.on('click', handleMapClick);
    })();

    return () => {
      if (map) { map.off('click', handleMapClick); map.remove(); mapRef.current = null; }
      if (layer) { layer.remove(); canvasLayerRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update map cursor based on mode
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.style.cursor = radiusMode === 'settingCenter' ? 'crosshair' : '';
  }, [radiusMode]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rm-root">
      <div ref={containerRef} className="rm-map" />

      {/* Controls */}
      <div className="rm-controls">
        {radiusMode === 'off' && (
          <button
            className="rm-btn"
            onClick={() => setRadiusMode('settingCenter')}
            title="Find all airports within a radius"
          >
            Find airports in radius
          </button>
        )}

        {radiusMode === 'settingCenter' && (
          <>
            <span className="rm-hint rm-hint--highlight">Tap anywhere on the map to set the center</span>
            <button className="rm-btn rm-btn--ghost" onClick={clearRadius}>Cancel</button>
          </>
        )}

        {radiusMode === 'active' && (
          <>
            <div className="rm-slider-group">
              <label className="rm-slider-label">Radius: {radiusKm} km</label>
              <input
                type="range"
                className="rm-slider"
                min={50} max={2000} step={50}
                value={radiusKm}
                onChange={e => setRadiusKm(parseInt(e.target.value, 10))}
              />
            </div>
            <button className="rm-btn rm-btn--ghost" onClick={clearRadius}>Clear</button>
          </>
        )}

        {radiusMode === 'off' && !selectedOrigin && (
          <span className="rm-hint">Click any airport to see routes</span>
        )}

        {radiusMode === 'off' && selectedOrigin && (
          <button className="rm-btn rm-btn--ghost" onClick={clearAll}>Clear</button>
        )}

      </div>

      {/* Selected origin info */}
      {selectedOrigin && (
        <div className="rm-info">
          <span className="rm-info-iata">{selectedOrigin.iata}</span>
          <div className="rm-info-right">
            <span className="rm-info-city">{selectedOrigin.city || selectedOrigin.name}</span>
            {routesLoading && <span className="rm-info-sub">Loading routes…</span>}
            {routesError && <span className="rm-info-sub rm-info-sub--err">{routesError}</span>}
            {routes && !routesLoading && (
              <>
                <span className="rm-info-sub">
                  {routes.destinations.length} destinations
                  {routes.destinations.length > 0 && <> · tap a purple dot for calendar</>}
                </span>
                {(() => {
                  const allAc = new Set();
                  Object.values(routes.aircraft || {}).forEach(arr => arr.forEach(t => allAc.add(t)));
                  if (!allAc.size) return null;
                  const sorted = Array.from(allAc).sort();
                  return (
                    <span className="rm-info-sub rm-info-sub--aircraft" title={sorted.join(', ')}>
                      {allAc.size} aircraft types: {sorted.slice(0, 8).join(' · ')}
                      {sorted.length > 8 && ` +${sorted.length - 8}`}
                    </span>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      {routes && (
        <div className="rm-legend">
          <div className="rm-legend-row"><span className="rm-legend-dot rm-legend-dot--live"/>Live (airborne now)</div>
          <div className="rm-legend-row"><span className="rm-legend-dot rm-legend-dot--scheduled"/>Scheduled today</div>
          <div className="rm-legend-row"><span className="rm-legend-dot rm-legend-dot--observed"/>Seen in last 30d</div>
        </div>
      )}

      {/* Radius info */}
      {radiusMode === 'active' && radiusCenterRef.current && (
        <div className="rm-info rm-info--radius">
          <span className="rm-info-iata">{radiusCount}</span>
          <span className="rm-info-city">airports within {radiusKm} km of {radiusCenterRef.current.city}</span>
        </div>
      )}

      {/* Validity calendar overlay */}
      {calendarRoute && (
        <ValidityCalendar
          origin={calendarRoute.origin}
          dest={calendarRoute.dest}
          onClose={() => setCalendarRoute(null)}
        />
      )}
    </div>
  );
}

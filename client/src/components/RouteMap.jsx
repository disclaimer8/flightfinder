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
// Draws all airport dots onto a single <canvas> overlay — much faster than
// creating thousands of Leaflet markers.

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

      const iata  = airports.pts[i];
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

  return { canvas, redraw, hitTest, remove: () => { map.off('move zoom viewreset resize', redraw); canvas.remove(); } };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RouteMap() {
  const containerRef   = useRef(null);
  const mapRef         = useRef(null);
  const canvasLayerRef = useRef(null);

  // Data
  const airportsDataRef = useRef(null); // compact airport payload

  // Selection state — kept in both React state (for UI) and refs (for canvas callbacks)
  const [selectedOrigin, setSelectedOriginState] = useState(null); // { iata, lat, lon, name, city }
  const selectedRef = useRef(null);

  const [routes, setRoutes]             = useState(null);  // { destinations:[], prices:{} }
  const routesRef                       = useRef(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError]   = useState(null);

  const highlightedRef = useRef(new Set());
  const inRadiusRef    = useRef(new Set());
  const routeLinesRef  = useRef([]);

  // Radius draw
  const [drawMode, setDrawMode]   = useState(false);
  const drawModeRef               = useRef(false);
  const [radiusInfo, setRadiusInfo] = useState(null); // { center, radiusKm, count }
  const radiusCircleRef           = useRef(null);
  const drawStateRef              = useRef({ active: false, center: null, circle: null });

  // Validity calendar
  const [calendarRoute, setCalendarRoute] = useState(null); // { origin, dest }

  // Sync drawMode to ref
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const setSelectedOrigin = (ap) => {
    selectedRef.current = ap?.iata ?? null;
    setSelectedOriginState(ap);
  };

  const redrawCanvas = () => canvasLayerRef.current?.redraw();

  const clearRouteLines = () => {
    const map = mapRef.current;
    if (!map) return;
    routeLinesRef.current.forEach(l => l.remove());
    routeLinesRef.current = [];
  };

  const clearRadius = () => {
    radiusCircleRef.current?.remove();
    radiusCircleRef.current = null;
    inRadiusRef.current = new Set();
    setRadiusInfo(null);
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

  // ── Load routes for a clicked airport ────────────────────────────────────

  const loadRoutes = async (ap) => {
    setRoutesLoading(true);
    setRoutesError(null);
    clearRouteLines();
    highlightedRef.current = new Set();

    try {
      const res  = await fetch(`/api/map/routes?origin=${ap.iata}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to load routes');

      setRoutes(data);
      routesRef.current = data;
      highlightedRef.current = new Set(data.destinations);

      // Draw geodesic arcs to each destination
      const map = mapRef.current;
      const L   = (await import('leaflet')).default;
      for (const destIata of data.destinations) {
        const idx   = airportsDataRef.current?.pts.indexOf(destIata);
        if (idx === -1 || idx == null) continue;
        const dLat  = airportsDataRef.current.crd[idx * 2];
        const dLon  = airportsDataRef.current.crd[idx * 2 + 1];
        const pts   = geodesicPoints(ap.lat, ap.lon, dLat, dLon);
        const line  = L.polyline(pts, {
          color: 'rgba(108,142,255,0.35)',
          weight: 1.2,
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
    if (drawModeRef.current) return; // handled by draw logic

    const layer = canvasLayerRef.current;
    if (!layer) return;

    const ap = layer.hitTest(e.containerPoint);
    if (!ap) {
      // Click on empty space — clear selection
      clearAll();
      return;
    }

    // If clicking a highlighted destination → open validity calendar
    if (routesRef.current?.destinations?.includes(ap.iata) && selectedRef.current) {
      const originIata = selectedRef.current;
      const originIdx  = airportsDataRef.current?.pts.indexOf(originIata) ?? -1;
      setCalendarRoute({
        origin: { iata: originIata, city: originIdx >= 0 ? airportsDataRef.current.cities[originIdx] : originIata },
        dest:   { iata: ap.iata, city: ap.city || ap.iata },
      });
      return;
    }

    // Select this airport as new origin
    clearRouteLines();
    clearRadius();
    highlightedRef.current = new Set();
    routesRef.current = null;
    setRoutes(null);
    setRoutesError(null);
    setSelectedOrigin(ap);
    redrawCanvas();
    loadRoutes(ap);
  };

  // ── Radius draw interaction ───────────────────────────────────────────────

  const setupRadiusDraw = (map, L) => {
    map.on('mousedown', (e) => {
      if (!drawModeRef.current) return;
      e.originalEvent.preventDefault();
      map.dragging.disable();
      map.scrollWheelZoom.disable();

      const state  = drawStateRef.current;
      state.active = true;
      state.center = e.latlng;
      state.circle = L.circle(e.latlng, {
        radius:      1000,
        color:       '#34d399',
        fillColor:   '#34d399',
        fillOpacity: 0.08,
        weight:      2,
        dashArray:   '6 4',
        interactive: false,
      }).addTo(map);
    });

    map.on('mousemove', (e) => {
      const state = drawStateRef.current;
      if (!state.active || !state.center || !state.circle) return;
      const km = haversineKm(state.center.lat, state.center.lng, e.latlng.lat, e.latlng.lng);
      state.circle.setRadius(Math.max(km * 1000, 1000));
    });

    const finishDraw = (e) => {
      const state = drawStateRef.current;
      if (!state.active) return;
      state.active = false;
      map.dragging.enable();
      map.scrollWheelZoom.enable();

      const center  = state.center;
      const km      = haversineKm(center.lat, center.lng, e.latlng.lat, e.latlng.lng);
      state.center  = null;

      if (km < 10) {
        // Too small — discard
        state.circle?.remove();
        state.circle = null;
        return;
      }

      // Keep circle, find airports in radius
      radiusCircleRef.current?.remove();
      radiusCircleRef.current = state.circle;
      state.circle = null;

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
      setRadiusInfo({ center, radiusKm: Math.round(km), count: inR.size });
      redrawCanvas();

      // Disable draw mode after drawing
      setDrawMode(false);
    };

    map.on('mouseup', finishDraw);
  };

  // ── Leaflet init ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (mapRef.current) return; // StrictMode guard

    let map;
    let layer;

    (async () => {
      const L = (await import('leaflet')).default;

      map = L.map(containerRef.current, {
        center:          [20, 0],
        zoom:            2,
        zoomControl:     true,
        attributionControl: true,
        worldCopyJump:   true,
      });

      mapRef.current = map;

      // CartoDB Dark Matter tiles (no API key needed)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://carto.com">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      // Fetch compact airport list
      const res      = await fetch('/api/map/airports');
      const airports = await res.json();
      airportsDataRef.current = airports;

      // Mount canvas dot layer
      layer = mountAirportCanvas(map, airports, {
        selected:    selectedRef,
        highlighted: highlightedRef,
        inRadius:    inRadiusRef,
      });
      canvasLayerRef.current = layer;

      // Map click → hit-test airports
      map.on('click', handleMapClick);

      // Radius draw interaction
      setupRadiusDraw(map, L);
    })();

    return () => {
      if (map) {
        map.off('click', handleMapClick);
        map.remove();
        mapRef.current = null;
      }
      if (layer) {
        layer.remove();
        canvasLayerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────

  const priceRange = routes ? (() => {
    const vals = Object.values(routes.prices).filter(Boolean);
    if (!vals.length) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  })() : null;

  return (
    <div className="rm-root">
      {/* Map container */}
      <div ref={containerRef} className="rm-map" />

      {/* Controls bar */}
      <div className="rm-controls">
        <button
          className={`rm-btn${drawMode ? ' rm-btn--active' : ''}`}
          onClick={() => {
            setDrawMode(v => !v);
            if (drawMode) clearRadius();
          }}
          title={drawMode ? 'Cancel draw' : 'Draw a radius circle to find airports in a zone'}
        >
          {drawMode ? 'Cancel draw' : 'Draw radius'}
        </button>

        {(selectedOrigin || radiusInfo) && (
          <button className="rm-btn rm-btn--ghost" onClick={clearAll}>
            Clear
          </button>
        )}

        {drawMode && (
          <span className="rm-hint">Click and drag on the map to draw a radius</span>
        )}

        {!drawMode && !selectedOrigin && !radiusInfo && (
          <span className="rm-hint">Click any airport to see routes</span>
        )}
      </div>

      {/* Info panel — selected origin + route summary */}
      {selectedOrigin && (
        <div className="rm-info">
          <div className="rm-info-origin">
            <span className="rm-info-iata">{selectedOrigin.iata}</span>
            <span className="rm-info-city">{selectedOrigin.city || selectedOrigin.name}</span>
          </div>

          {routesLoading && <p className="rm-info-sub">Loading routes…</p>}
          {routesError && <p className="rm-info-sub rm-info-sub--err">{routesError}</p>}

          {routes && !routesLoading && (
            <p className="rm-info-sub">
              {routes.destinations.length} destination{routes.destinations.length !== 1 ? 's' : ''}
              {priceRange && (
                <span className="rm-info-price">
                  &nbsp;· from <strong>${Math.round(priceRange.min)}</strong>
                </span>
              )}
              &nbsp;· <em>click a purple dot to view calendar</em>
            </p>
          )}

          {routes && routes.destinations.length === 0 && !routesLoading && (
            <p className="rm-info-sub rm-info-sub--err">No inspiration routes in Amadeus test data for this airport</p>
          )}
        </div>
      )}

      {/* Radius info panel */}
      {radiusInfo && (
        <div className="rm-info rm-info--radius">
          <span className="rm-info-iata">{radiusInfo.count}</span>
          <span className="rm-info-city">
            airports within {radiusInfo.radiusKm} km
          </span>
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

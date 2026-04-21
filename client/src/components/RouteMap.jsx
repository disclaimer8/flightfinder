import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { API_BASE } from '../utils/api';
import './RouteMap.css';
import ValidityCalendar from './ValidityCalendar';

// ── Hub airports for low-zoom rendering ─────────────────────────────────────
// ~200 busiest/most-connected airports, drawn at zoom < 5 to keep world view
// readable. Curated from Wikipedia "List of busiest airports by passenger
// traffic" (top ~120) plus major regional hubs (LATAM, Africa, CIS, SE Asia,
// Oceania, MENA) where global-top-120 coverage is thin.
// Source: https://en.wikipedia.org/wiki/List_of_busiest_airports_by_passenger_traffic
const HUB_IATAS = new Set([
  // North America (US + CA + MX) — top-volume airports only
  'ATL','DFW','DEN','ORD','LAX','JFK','LAS','MCO','MIA','CLT','SEA','PHX','EWR',
  'SFO','IAH','BOS','MSP','FLL','LGA','DTW','PHL','SLC','BWI','DCA','SAN','IAD',
  'TPA','AUS','BNA','MDW','HNL','PDX','STL','RDU','HOU','OAK',
  'YYZ','YVR','YUL','YYC',
  'MEX','CUN','GDL','MTY',
  // Europe (top ~40 by pax + key regional capitals)
  'LHR','CDG','AMS','FRA','MAD','IST','BCN','MUC','FCO','LGW','ORY','DUB','ZRH',
  'CPH','VIE','OSL','ARN','HEL','BRU','LIS','ATH','MXP','PMI','AGP','DUS','BER',
  'STN','MAN','NCE','BUD','PRG','WAW','OTP','SAW','AYT','ADB',
  // Russia / CIS (top 5 — most of it gets culled from live routes anyway)
  'SVO','DME','VKO','LED','ALA','TAS',
  // Middle East (all-hubs region)
  'DXB','DOH','AUH','JED','RUH','KWI','BAH','MCT','AMM','TLV','CAI','SHJ',
  // Africa (regional capitals only)
  'JNB','CPT','ADD','NBO','LOS','CMN','ALG','TUN','ACC','DKR','DAR','EBB',
  // Asia – East China + HK + TW + KR + JP
  'PEK','PKX','PVG','SHA','CAN','CTU','SZX','KMG','XIY','HGH','CKG','NKG','WUH',
  'HKG','TPE','ICN','GMP','PUS','HND','NRT','KIX','NGO','FUK','CTS','OKA',
  // Asia – SE + South + Central
  'SIN','BKK','DMK','KUL','CGK','DPS','MNL','CEB','HAN','SGN','HKT','CNX',
  'DEL','BOM','BLR','MAA','HYD','CCU','AMD','COK','GOI',
  'KHI','LHE','ISB','KTM','DAC','CMB','MLE',
  // Oceania
  'SYD','MEL','BNE','PER','ADL','AKL','CHC','WLG','NAN','PPT',
  // Latin America / Caribbean (capitals + top beach gateways)
  'GRU','GIG','BSB','CNF','POA','FOR','REC','VCP',
  'EZE','AEP',
  'SCL','LIM','UIO','BOG','MDE','CCS','PTY','SJO','GUA','SAL',
  'HAV','SDQ','PUJ','NAS','MBJ','BGI','SJU',
]);

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

// ── Canvas hub-network baseline layer ────────────────────────────────────────
// Draws faint polylines between every pair of hub airports so the world view
// is never empty. A single batched beginPath/stroke per alpha bucket keeps
// 3000 edges × 15 steps (~45k segments) cheap: one draw call per redraw.
function mountBaselineCanvas(map, airports, edges, refs) {
  const pane = map.getPanes().overlayPane;
  const canvas = document.createElement('canvas');
  canvas.className = 'rm-baseline-canvas';

  // Prepend so Leaflet polylines (selection arcs, added later) and the
  // airport canvas (appended separately) render ABOVE the baseline.
  if (pane.firstChild) pane.insertBefore(canvas, pane.firstChild);
  else pane.appendChild(canvas);

  // Build IATA → index lookup once. pts is an Array of strings.
  const iataIdx = new Map();
  for (let i = 0; i < airports.pts.length; i++) {
    iataIdx.set(airports.pts[i], i);
  }

  // Pre-resolve edges to [lat1,lon1,lat2,lon2] — skip edges whose endpoints
  // we can't locate so redraw() can just loop and project.
  const resolved = [];
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    const ia = iataIdx.get(a);
    const ib = iataIdx.get(b);
    if (ia == null || ib == null) continue;
    resolved.push([
      airports.crd[ia * 2], airports.crd[ia * 2 + 1],
      airports.crd[ib * 2], airports.crd[ib * 2 + 1],
    ]);
  }

  const redraw = () => {
    if (!map || !canvas) return;
    const size = map.getSize();
    canvas.width  = size.x;
    canvas.height = size.y;
    const tl = map.containerPointToLayerPoint([0, 0]);
    canvas.style.transform = `translate(${tl.x}px,${tl.y}px)`;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.x, size.y);
    if (!resolved.length) return;

    // Dim further when a selection is active so the bright polylines pop.
    const dim = refs.selected.current !== null;
    ctx.strokeStyle = dim ? 'rgba(148,163,184,0.05)' : 'rgba(148,163,184,0.10)';
    ctx.lineWidth   = 0.8;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    ctx.beginPath();
    for (let i = 0; i < resolved.length; i++) {
      const [lat1, lon1, lat2, lon2] = resolved[i];
      const pts = geodesicPoints(lat1, lon1, lat2, lon2, 15);
      // Cull edges whose entire arc is outside the viewport — quick AABB
      // check on projected points. Saves a lot of lineTo when zoomed in.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const proj = new Array(pts.length);
      for (let k = 0; k < pts.length; k++) {
        const p = map.latLngToContainerPoint(pts[k]);
        proj[k] = p;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (maxX < -20 || minX > size.x + 20 || maxY < -20 || minY > size.y + 20) continue;

      ctx.moveTo(proj[0].x, proj[0].y);
      for (let k = 1; k < proj.length; k++) {
        ctx.lineTo(proj[k].x, proj[k].y);
      }
    }
    ctx.stroke();
  };

  map.on('move zoom viewreset resize', redraw);
  redraw();

  return {
    canvas,
    redraw,
    edgeCount: resolved.length,
    remove: () => {
      map.off('move zoom viewreset resize', redraw);
      canvas.remove();
    },
  };
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
    const hubOnly = zoom < 5;

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

      // At low zoom, only render hubs — unless this airport is selected,
      // highlighted (destination arc), or inside the radius set. Hit-test
      // still sees every airport so users can click non-hubs to zoom in.
      if (hubOnly && !isSel && !isHigh && !isInR && !HUB_IATAS.has(iata)) continue;

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
  const baselineLayerRef = useRef(null);

  const airportsDataRef = useRef(null);
  const hubEdgesRef     = useRef(null);

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
    // Baseline re-renders with different alpha depending on whether a route
    // is selected (faint → even fainter when selection active).
    baselineLayerRef.current?.redraw();
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

  // Pan so the origin airport lands in the upper-right quadrant, giving arcs
  // room to fan out across the rest of the map. Keeps current zoom.
  const panOriginToTopRight = (ap) => {
    const map = mapRef.current;
    if (!map || !ap) return;

    const size = map.getSize();
    if (!size || size.x === 0 || size.y === 0) return;

    const isMobile = size.x < 600;
    const targetX  = size.x * (isMobile ? 0.70 : 0.75);
    const targetY  = size.y * (isMobile ? 0.35 : 0.25);

    // The current center of the map sits at (size/2). To move the origin
    // to (targetX, targetY) in container coords, shift the center by the
    // delta between origin's current container point and the target.
    const originPt = map.latLngToContainerPoint([ap.lat, ap.lon]);
    const dx = originPt.x - targetX;
    const dy = originPt.y - targetY;
    const centerPt = map.latLngToContainerPoint(map.getCenter());
    const newCenterLatLng = map.containerPointToLatLng([centerPt.x + dx, centerPt.y + dy]);

    map.flyTo(newCenterLatLng, map.getZoom(), { duration: 0.8 });
  };

  const loadRoutes = async (ap) => {
    setRoutesLoading(true);
    setRoutesError(null);
    clearRouteLines();
    highlightedRef.current = new Set();

    try {
      const res  = await fetch(`${API_BASE}/api/map/routes?origin=${ap.iata}`);
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

      // Pan origin to top-right so destination arcs have room to fan out.
      // Skip when radius mode is active (don't fight the user) or when there
      // are no destinations (nothing to reveal).
      if (radiusModeRef.current === 'off' && data.destinations?.length > 0) {
        panOriginToTopRight(ap);
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

    // StrictMode mounts-unmounts-mounts synchronously in dev. The async IIFE
    // below awaits imports/fetch before assigning mapRef.current, so the
    // cleanup closure needs this flag to know whether to tear down work
    // performed by *this* effect run (not a later one).
    let cancelled = false;
    let map = null;
    let layer = null;
    let baselineLayer = null;
    let clickHandler = null;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;

      // Second safety: if another effect run already created a map on this
      // container, bail rather than stacking a second Leaflet instance.
      if (mapRef.current) return;

      map = L.map(containerRef.current, {
        center: [20, 0],
        zoom:   2,
        worldCopyJump: true,
      });
      mapRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://carto.com">CARTO</a> | Aircraft data: AirLabs + <a href="https://adsb.lol">adsb.lol</a> (ODbL)',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      const res      = await fetch(`${API_BASE}/api/map/airports`);
      const airports = await res.json();
      if (cancelled) {
        // Effect was torn down while we were awaiting — undo what we created.
        map.remove();
        if (mapRef.current === map) mapRef.current = null;
        map = null;
        return;
      }
      airportsDataRef.current = airports;

      layer = mountAirportCanvas(map, airports, {
        selected:    selectedRef,
        highlighted: highlightedRef,
        inRadius:    inRadiusRef,
      });
      canvasLayerRef.current = layer;

      // Fetch hub-to-hub network baseline. Failure is non-fatal — the map
      // simply shows up empty like before.
      try {
        const hubRes = await fetch(`${API_BASE}/api/map/hub-network`);
        if (hubRes.ok) {
          const hubData = await hubRes.json();
          if (cancelled) {
            map.remove();
            if (mapRef.current === map) mapRef.current = null;
            map = null;
            return;
          }
          const edges = Array.isArray(hubData?.edges) ? hubData.edges : [];
          hubEdgesRef.current = edges;
          if (edges.length) {
            baselineLayer = mountBaselineCanvas(map, airports, edges, {
              selected: selectedRef,
            });
            baselineLayerRef.current = baselineLayer;
          }
        } else {
          console.warn('[RouteMap] hub-network fetch returned', hubRes.status);
        }
      } catch (err) {
        if (!cancelled) console.warn('[RouteMap] hub-network fetch failed', err);
      }

      clickHandler = handleMapClick;
      map.on('click', clickHandler);
    })();

    return () => {
      cancelled = true;
      if (map) {
        if (clickHandler) map.off('click', clickHandler);
        if (baselineLayer) { baselineLayer.remove(); baselineLayerRef.current = null; }
        if (layer) { layer.remove(); canvasLayerRef.current = null; }
        map.remove();
        if (mapRef.current === map) mapRef.current = null;
        map = null;
      }
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
          <div className="rm-legend-row"><span className="rm-legend-dot rm-legend-dot--baseline"/>Hub network (faint)</div>
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

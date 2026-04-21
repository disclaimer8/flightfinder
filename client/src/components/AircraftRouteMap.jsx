import { useEffect, useRef, useState, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';
import { geodesicPoints, ORIGIN_PALETTE } from './mapArcHelpers';
import { useAircraftSearch } from '../hooks/useAircraftSearch';
import AircraftSearchResults from './AircraftSearchResults';
import AircraftFlightCard from './AircraftFlightCard';
import './RouteMap.css';
import './AircraftRouteMap.css';

// localStorage key for the list/map view preference. Read on mount, written on change.
const VIEW_STORAGE_KEY = 'flightfinder.aircraftView';

function readInitialView() {
  if (typeof window === 'undefined') return 'list';
  try {
    const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return v === 'map' ? 'map' : 'list';
  } catch {
    return 'list';
  }
}

/**
 * AircraftRouteMap — Phase 3 "map as output" view for by-aircraft search.
 *
 * Props:
 *   familyName    — display string ("Airbus A340 family")
 *   family        — identifier passed to /api/aircraft/routes (slug OR name;
 *                   backend must accept whatever we send)
 *   date          — YYYY-MM-DD, used when kicking off the SSE stream after
 *                   a destination click
 *   passengers    — integer
 *   originIatas   — string[] of exact origin IATA codes to map
 *   onBack        — () => void — back-to-form handler
 */
export default function AircraftRouteMap({
  familyName,
  family,
  date,
  passengers,
  originIatas,
  directOnly = false,
  onBack,
}) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const arcCanvasRef  = useRef(null);    // { canvas, redraw, remove }
  const dotsCanvasRef = useRef(null);    // { canvas, redraw, hitTest, remove }

  const [data, setData]         = useState(null);   // backend response
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // View mode — 'list' (bookable cards) vs 'map' (Leaflet route map).
  // Default = 'list' so users see actionable flights first; map is opt-in.
  // Persisted in localStorage so the choice sticks across sessions.
  const [view, setView] = useState(readInitialView);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* ignore quota */ }
  }, [view]);

  // Cascade fallback state:
  //  - fallbackLevel: 1 = original scoped fetch, 2 = auto-retried global,
  //                    3 = give up on routes and show flight cards.
  //  - fallbackTriedGlobal: guard so the Level-2 effect only fires once.
  const [fallbackLevel, setFallbackLevel]             = useState(1);
  const [fallbackTriedGlobal, setFallbackTriedGlobal] = useState(false);

  // UI state
  const [filteredOrigin, setFilteredOrigin] = useState(null); // IATA or null
  const [panel, setPanel]                   = useState(null); // { dep, arr, depName, arrName } or null
  const [legendOpen, setLegendOpen]         = useState(false);
  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [isMobile, setIsMobile]             = useState(
    typeof window !== 'undefined' && window.innerWidth < 600
  );

  // SSE flight search — used both for:
  //   (a) list-view default (user picked the cards tab), and
  //   (b) Level-3 fallback from map-view when no observed routes exist.
  // `cardsKickedRef` guards against re-kicking the same stream when the user
  // toggles map → list → map for the same (family, origin, date) tuple.
  const cardsSearch = useAircraftSearch();
  const cardsKickedRef = useRef(false);

  // Refs that the canvas redraw callbacks read from each frame.
  const dataRef           = useRef(null);
  const filteredOriginRef = useRef(null);
  const originColorRef    = useRef(new Map()); // iata → colour
  const originByIataRef   = useRef(new Map()); // iata → origin object
  const destsRef          = useRef([]);        // [{iata, lat, lon, count}]

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { filteredOriginRef.current = filteredOrigin; }, [filteredOrigin]);

  // Track viewport size → swap legend for bottom-sheet toggle on mobile.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Reset cascade state whenever the user re-runs a search with new inputs.
  // (A manual refresh also counts — it should re-check the scoped view first.)
  useEffect(() => {
    setFallbackLevel(1);
    setFallbackTriedGlobal(false);
    cardsKickedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, familyName, (originIatas || []).join(','), refreshTick, date, directOnly]);

  // ── Fetch backend route data ──────────────────────────────────────────────
  useEffect(() => {
    // List view never fetches route data — it only uses the SSE search hook.
    if (view !== 'map') return;
    // Level 3 doesn't hit /api/aircraft/routes — it uses the SSE search hook.
    if (fallbackLevel >= 3) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    // At level 2 we intentionally drop the origins filter for a worldwide view.
    const useGlobal = fallbackLevel === 2;
    const origins = useGlobal
      ? ''
      : (originIatas || []).filter(Boolean).join(',');
    const qs = new URLSearchParams();
    qs.set('family', family || familyName || '');
    if (origins) qs.set('origins', origins); // omit for global (worldwide) mode
    qs.set('windowDays', '14');
    if (refreshTick) qs.set('_', String(Date.now()));

    fetch(`/api/aircraft/routes?${qs.toString()}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(json => {
        if (cancelled) return;
        setData(json);

        // Build origin colour map + lookups.
        const colours = new Map();
        const byIata  = new Map();
        (json.origins || []).forEach((o, i) => {
          colours.set(o.iata, ORIGIN_PALETTE[i % ORIGIN_PALETTE.length]);
          byIata.set(o.iata, o);
        });
        originColorRef.current = colours;
        originByIataRef.current = byIata;

        // Resolve destination coords. Each route entry has dep + arr IATA but
        // no arr coords — we need them to draw the arc and hit-test dots.
        // Strategy: if the backend response already embeds `destCoords`
        // (future-proofing), use that; otherwise look for an `airports`
        // dictionary; otherwise fall back to /api/map/airports (async).
        const destMap = new Map();   // iata → {iata, lat, lon, count}
        const knownCoords = new Map();
        (json.origins || []).forEach(o => knownCoords.set(o.iata, [o.lat, o.lon]));
        (json.airports || []).forEach(a => knownCoords.set(a.iata, [a.lat, a.lon]));

        (json.routes || []).forEach(r => {
          const coords = knownCoords.get(r.arr);
          if (!coords) return;
          const existing = destMap.get(r.arr);
          if (existing) existing.count += (r.count || 1);
          else destMap.set(r.arr, {
            iata: r.arr, lat: coords[0], lon: coords[1], count: r.count || 1,
          });
        });

        // If we're missing coords, fetch the shared airport index.
        const missing = (json.routes || []).filter(r => !knownCoords.has(r.arr));
        if (missing.length === 0) {
          destsRef.current = Array.from(destMap.values());
          setLoading(false);
          arcCanvasRef.current?.redraw();
          dotsCanvasRef.current?.redraw();
          fitToRoutes(json);
        } else {
          fetch('/api/map/airports')
            .then(r => r.json())
            .then(ap => {
              if (cancelled) return;
              // airports payload shape from RouteMap.jsx: {pts, crd, ...}
              if (ap && Array.isArray(ap.pts) && Array.isArray(ap.crd)) {
                const idx = new Map();
                for (let i = 0; i < ap.pts.length; i++) idx.set(ap.pts[i], i);
                (json.routes || []).forEach(r => {
                  const i = idx.get(r.arr);
                  if (i == null) return;
                  const lat = ap.crd[i * 2];
                  const lon = ap.crd[i * 2 + 1];
                  const existing = destMap.get(r.arr);
                  if (existing) existing.count += (r.count || 1);
                  else destMap.set(r.arr, { iata: r.arr, lat, lon, count: r.count || 1 });
                });
              }
              destsRef.current = Array.from(destMap.values());
              setLoading(false);
              arcCanvasRef.current?.redraw();
              dotsCanvasRef.current?.redraw();
              fitToRoutes(json);
            })
            .catch(() => {
              if (cancelled) return;
              destsRef.current = Array.from(destMap.values());
              setLoading(false);
              arcCanvasRef.current?.redraw();
              dotsCanvasRef.current?.redraw();
              fitToRoutes(json);
            });
        }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Failed to load route data');
        setLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, familyName, (originIatas || []).join(','), refreshTick, fallbackLevel, view]);

  // ── Cascade fallback: escalate to Level 2 (global) or Level 3 (cards) ─────
  // Triggered whenever a fetch just finished with zero observed routes. We
  // avoid looping by gating on fallbackTriedGlobal and fallbackLevel.
  //
  // Race note: on a level change the fetch effect calls setLoading(true)
  // asynchronously, so this effect can re-fire in the same render cycle with
  // the old `loading=false` and stale `data`. Guard against that by clearing
  // `data` to null whenever we bump the level — the !data check above then
  // suppresses re-entry until the new fetch lands.
  useEffect(() => {
    if (view !== 'map') return;
    if (loading || error || !data) return;
    const hasRoutes   = (data.routes || []).length > 0;
    if (hasRoutes) return;

    const hadOrigins = (originIatas || []).filter(Boolean).length > 0;

    // Level 1 → Level 2: we had specific origins, try worldwide once.
    if (fallbackLevel === 1 && hadOrigins && !fallbackTriedGlobal) {
      setFallbackTriedGlobal(true);
      setData(null);
      setLoading(true);
      setFallbackLevel(2);
      return;
    }

    // Level 1 with no origins (user already searched globally) → jump to 3.
    // Level 2 returned empty too → escalate to card-list view.
    if ((fallbackLevel === 1 && !hadOrigins) || fallbackLevel === 2) {
      setData(null);
      setFallbackLevel(3);
    }
  }, [view, loading, error, data, fallbackLevel, fallbackTriedGlobal, originIatas]);

  // Kick the SSE flight search exactly once per (family, origin, date) tuple.
  // Fires when either:
  //   - the user is in list view (cards are the default surface), OR
  //   - the map-view cascade escalated to Level 3 (no observed routes).
  // `cardsKickedRef` prevents re-kick on map↔list toggles within the same
  // search inputs; it's reset when inputs change (see the reset effect above).
  useEffect(() => {
    const shouldKick = view === 'list' || fallbackLevel === 3;
    if (!shouldKick) return;
    if (cardsKickedRef.current) return;
    cardsKickedRef.current = true;

    const firstOrigin = (originIatas || []).filter(Boolean)[0];
    cardsSearch.search({
      familyName,
      iata: firstOrigin || undefined,
      date: date || null,
      passengers: passengers || 1,
      nonStop: directOnly,
    });
    // Hook cleans up its own EventSource; we cancel it when this component
    // unmounts via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fallbackLevel]);

  // Cancel any in-flight SSE stream on unmount / input change.
  useEffect(() => {
    return () => { cardsSearch.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit the map to show all origins and destinations with a comfortable pad.
  const fitToRoutes = useCallback((json) => {
    const map = mapRef.current;
    if (!map) return;
    const pts = [];
    (json.origins || []).forEach(o => pts.push([o.lat, o.lon]));
    destsRef.current.forEach(d => pts.push([d.lat, d.lon]));
    if (pts.length === 0) return;
    import('leaflet').then(({ default: L }) => {
      const bounds = L.latLngBounds(pts);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
    });
  }, []);

  // ── Leaflet init ─────────────────────────────────────────────────────────
  // Gated on view === 'map'. In list view we skip this entirely, so Leaflet's
  // ~150KB runtime never gets loaded and the map DOM never gets instantiated.
  // When the user toggles to map, this effect fires and sets things up; when
  // they toggle back to list, the cleanup below tears the map down so we
  // don't hold onto a detached canvas stack.
  useEffect(() => {
    if (view !== 'map') return;
    if (!containerRef.current) return;
    if (mapRef.current) return;
    let cancelled = false;
    let map = null;
    let clickHandler = null;
    let arcLayer = null;
    let dotLayer = null;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      if (mapRef.current) return;
      if (!containerRef.current) return;

      map = L.map(containerRef.current, {
        center: [30, 10],
        zoom: 3,
        worldCopyJump: true,
      });
      mapRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://carto.com">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      arcLayer = mountArcCanvas(map, destsRef, originByIataRef, originColorRef, filteredOriginRef);
      arcCanvasRef.current = arcLayer;

      dotLayer = mountDotsCanvas(map, destsRef, originByIataRef, originColorRef, filteredOriginRef);
      dotsCanvasRef.current = dotLayer;

      clickHandler = (e) => {
        const hit = dotLayer.hitTest(e.containerPoint);
        if (!hit) return;

        if (hit.type === 'origin') {
          // Toggle origin filter.
          setFilteredOrigin(prev => (prev === hit.iata ? null : hit.iata));
        } else if (hit.type === 'dest') {
          // Open the side panel / bottom sheet for this dest.
          // Pick a representative origin — if a filter is active, use it;
          // otherwise fall back to the first origin that has a route to
          // this destination.
          const d = dataRef.current;
          const cur = filteredOriginRef.current;
          let dep = cur;
          if (!dep && d?.routes) {
            const r = d.routes.find(x => x.arr === hit.iata);
            dep = r?.dep;
          }
          if (!dep) return;
          const depOrig = originByIataRef.current.get(dep);
          setPanel({
            dep,
            arr: hit.iata,
            depName: depOrig?.name || dep,
            arrName: hit.name || hit.iata,
          });
        }
      };
      map.on('click', clickHandler);

      // If data arrived before the map was ready, fit now.
      if (dataRef.current) fitToRoutes(dataRef.current);
    })();

    return () => {
      cancelled = true;
      if (map) {
        if (clickHandler) map.off('click', clickHandler);
        if (arcLayer) { arcLayer.remove(); arcCanvasRef.current = null; }
        if (dotLayer) { dotLayer.remove(); dotsCanvasRef.current = null; }
        map.remove();
        if (mapRef.current === map) mapRef.current = null;
        map = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Redraw when the filter changes (so arcs dim / brighten).
  useEffect(() => {
    arcCanvasRef.current?.redraw();
    dotsCanvasRef.current?.redraw();
  }, [filteredOrigin]);

  // Push route data into the arc canvas whenever it changes.
  useEffect(() => {
    if (!data || !arcCanvasRef.current) return;
    arcCanvasRef.current.setData(data.routes || []);
    dotsCanvasRef.current?.redraw();
  }, [data]);

  // ── Rendering ────────────────────────────────────────────────────────────
  const routes = data?.routes || [];
  const originList = data?.origins || [];
  const suggestions = data?.suggestions || [];
  const requestedOrigins = (originIatas || []).filter(Boolean);
  const requestedLabel = requestedOrigins.join(', ');

  // Per-origin route counts for the legend.
  const originCounts = new Map();
  routes.forEach(r => originCounts.set(r.dep, (originCounts.get(r.dep) || 0) + 1));

  // Reusable view toggle — two buttons (List | Map) with aria-pressed semantics.
  // Rendered inside both the list-view header and the map-view badge so the
  // control stays in the same visual slot across modes.
  const renderViewToggle = () => (
    <div className="arm-view-toggle" role="group" aria-label="View mode">
      <button
        type="button"
        className={`arm-view-btn${view === 'list' ? ' arm-view-btn--active' : ''}`}
        aria-pressed={view === 'list'}
        onClick={() => setView('list')}
      >
        List
      </button>
      <button
        type="button"
        className={`arm-view-btn${view === 'map' ? ' arm-view-btn--active' : ''}`}
        aria-pressed={view === 'map'}
        onClick={() => setView('map')}
      >
        Map
      </button>
    </div>
  );

  // ── List view (default) ──────────────────────────────────────────────────
  // Never renders the Leaflet container — SSE cards only. Toggle sits next to
  // the back button in the header bar.
  if (view === 'list') {
    return (
      <div className="arm-root arm-root--cards">
        <div className="arm-badge arm-badge--cards">
          <button
            className="arm-back"
            onClick={onBack}
            aria-label="Back to search"
            title="Back to search"
          >
            ←
          </button>
          <div className="arm-badge-body">
            <span className="arm-badge-label">Bookable flights</span>
            {familyName && <span className="arm-badge-family">{familyName}</span>}
          </div>
          {renderViewToggle()}
        </div>
        <div className="arm-cards-wrap">
          <AircraftSearchResults
            results={cardsSearch.results}
            progress={cardsSearch.progress}
            pct={cardsSearch.pct}
            status={cardsSearch.status}
            error={cardsSearch.error}
            familyName={familyName}
            passengers={passengers}
          />
        </div>
      </div>
    );
  }

  // Level 3 — no observed routes at all, even globally. Show the flight-card
  // view instead of the (now empty) map.
  if (fallbackLevel === 3) {
    return (
      <div className="arm-root arm-root--cards">
        <div className="arm-badge arm-badge--cards">
          <button
            className="arm-back"
            onClick={onBack}
            aria-label="Back to search"
            title="Back to search"
          >
            ←
          </button>
          <div className="arm-badge-body">
            <span className="arm-badge-label">Bookable flights</span>
            {familyName && <span className="arm-badge-family">{familyName}</span>}
          </div>
          {renderViewToggle()}
        </div>
        <div className="arm-fallback-banner arm-fallback-banner--level3">
          No observed routes data for {familyName || 'this aircraft'} yet —
          showing bookable flights instead.
        </div>
        <div className="arm-cards-wrap">
          <AircraftSearchResults
            results={cardsSearch.results}
            progress={cardsSearch.progress}
            pct={cardsSearch.pct}
            status={cardsSearch.status}
            error={cardsSearch.error}
            familyName={familyName}
            passengers={passengers}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="arm-root">
      <div ref={containerRef} className="rm-map" />

      {/* Top-left badge */}
      <div className="arm-badge">
        <button
          className="arm-back"
          onClick={onBack}
          aria-label="Back to search"
          title="Back to search"
        >
          ←
        </button>
        <div className="arm-badge-body">
          <span className="arm-badge-label">
            {loading
              ? 'Loading…'
              : `Observed in last ${data?.windowDays ?? 14} days · ${routes.length} routes`}
          </span>
          {familyName && <span className="arm-badge-family">{familyName}</span>}
        </div>
        <button
          className="arm-refresh"
          onClick={() => setRefreshTick(t => t + 1)}
          aria-label="Refresh"
          title="Refresh"
          disabled={loading}
        >
          ↻
        </button>
        {renderViewToggle()}
      </div>

      {/* Level-2 banner: global-mode retry after scoped origins came back empty */}
      {fallbackLevel === 2 && !loading && !error && routes.length > 0 && (
        <div className="arm-fallback-banner arm-fallback-banner--level2">
          <span className="arm-fallback-banner-text">
            No {familyName || 'flights'} observed from {requestedLabel || 'those airports'} in
            the last 14 days — showing all {familyName || 'matching'} routes worldwide instead.
          </span>
          {suggestions.length > 0 && (
            <div className="arm-fallback-suggestions">
              <span className="arm-fallback-suggestions-label">Try a nearby hub:</span>
              {suggestions.map(s => (
                <button
                  key={s.iata}
                  className="arm-fallback-suggestion"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('arm-swap-origin', {
                      detail: { iata: s.iata },
                    }));
                  }}
                  title={`${s.name} · ${s.distanceKm} km · ${s.routeCount} routes`}
                >
                  {s.iata}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top-right legend (desktop) OR toggle + bottom sheet (mobile) */}
      {!isMobile && originList.length > 0 && (
        <div className="arm-legend">
          {originList.map(o => {
            const color = originColorRef.current.get(o.iata) ||
              ORIGIN_PALETTE[0];
            const n = originCounts.get(o.iata) || 0;
            const isActive = filteredOrigin === o.iata;
            return (
              <button
                key={o.iata}
                className={`arm-legend-row${isActive ? ' arm-legend-row--active' : ''}`}
                onClick={() => setFilteredOrigin(prev => (prev === o.iata ? null : o.iata))}
              >
                <span className="arm-legend-dot" style={{ background: color }} />
                <span className="arm-legend-iata">{o.iata}</span>
                <span className="arm-legend-count">{n} routes</span>
              </button>
            );
          })}
          {filteredOrigin && (
            <button
              className="arm-legend-clear"
              onClick={() => setFilteredOrigin(null)}
            >
              Show all
            </button>
          )}
        </div>
      )}

      {isMobile && originList.length > 0 && (
        <>
          <button
            className="arm-legend-toggle"
            onClick={() => setLegendOpen(v => !v)}
          >
            {filteredOrigin ? `Origin: ${filteredOrigin}` : `${originList.length} origins`}
          </button>
          {legendOpen && (
            <div className="arm-sheet arm-sheet--legend">
              <div className="arm-sheet-header">
                <span>Origins</span>
                <button className="arm-sheet-close" onClick={() => setLegendOpen(false)}>×</button>
              </div>
              {originList.map(o => {
                const color = originColorRef.current.get(o.iata) ||
                  ORIGIN_PALETTE[0];
                const n = originCounts.get(o.iata) || 0;
                const isActive = filteredOrigin === o.iata;
                return (
                  <button
                    key={o.iata}
                    className={`arm-legend-row${isActive ? ' arm-legend-row--active' : ''}`}
                    onClick={() => {
                      setFilteredOrigin(prev => (prev === o.iata ? null : o.iata));
                      setLegendOpen(false);
                    }}
                  >
                    <span className="arm-legend-dot" style={{ background: color }} />
                    <span className="arm-legend-iata">{o.iata}</span>
                    <span className="arm-legend-count">{n} routes</span>
                  </button>
                );
              })}
              {filteredOrigin && (
                <button
                  className="arm-legend-clear"
                  onClick={() => { setFilteredOrigin(null); setLegendOpen(false); }}
                >
                  Show all
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Mobile destinations drawer (tappable list fallback) */}
      {isMobile && routes.length > 0 && (
        <>
          <button
            className="arm-drawer-toggle"
            onClick={() => setDrawerOpen(v => !v)}
          >
            {drawerOpen ? 'Hide routes' : `List ${routes.length} routes`}
          </button>
          {drawerOpen && (
            <div className="arm-sheet arm-sheet--drawer">
              <div className="arm-sheet-header">
                <span>Routes</span>
                <button className="arm-sheet-close" onClick={() => setDrawerOpen(false)}>×</button>
              </div>
              <div className="arm-route-list">
                {routes
                  .filter(r => !filteredOrigin || r.dep === filteredOrigin)
                  .map((r, i) => {
                    const color = originColorRef.current.get(r.dep) || ORIGIN_PALETTE[0];
                    return (
                      <button
                        key={`${r.dep}-${r.arr}-${i}`}
                        className="arm-route-row"
                        onClick={() => {
                          const depOrig = originByIataRef.current.get(r.dep);
                          setPanel({
                            dep: r.dep,
                            arr: r.arr,
                            depName: depOrig?.name || r.dep,
                            arrName: r.arr,
                          });
                          setDrawerOpen(false);
                        }}
                      >
                        <span className="arm-route-dot" style={{ background: color }} />
                        <span className="arm-route-iata">{r.dep}</span>
                        <span className="arm-route-arrow">→</span>
                        <span className="arm-route-iata">{r.arr}</span>
                        <span className="arm-route-count">×{r.count}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Loading spinner */}
      {loading && (
        <div className="arm-spinner" aria-label="Loading">
          <span className="arm-spinner-dot" />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="arm-error">
          <p>Failed to load routes: {error}</p>
          <button className="rm-btn" onClick={() => setRefreshTick(t => t + 1)}>Retry</button>
          <button className="rm-btn rm-btn--ghost" onClick={onBack}>Back to search</button>
        </div>
      )}

      {/* Empty state — only if the cascade has fully resolved at level 2
          with zero routes globally (we'll almost always escalate to Level 3
          in that case, but keep this as a safety net while that transition
          is in flight or if the SSE hook is unavailable). Suppress during
          the Level-1 → Level-2 handoff so there's no empty-state flash. */}
      {!loading && !error && routes.length === 0 && fallbackLevel === 2 && (
        <div className="arm-empty">
          <span className="arm-empty-icon">✈</span>
          <h3 className="arm-empty-title">
            No {familyName || 'flights'} seen from these airports in the last 14 days.
          </h3>
          {suggestions.length > 0 && (
            <>
              <p className="arm-empty-hint">Try a nearby hub:</p>
              <div className="arm-suggestions">
                {suggestions.map(s => (
                  <button
                    key={s.iata}
                    className="arm-suggestion"
                    onClick={() => {
                      // Swap origin set to just this suggestion.
                      // We can't mutate the parent's props, but we can fetch
                      // against the new origin set by triggering a re-fetch.
                      // Simplest: replace via window history or prop shim —
                      // but since originIatas is a prop, we use a local
                      // override via setRefreshTick + a ref hack would be
                      // brittle. Instead, we fire the onBack + re-form
                      // submit pattern is also complex. Pragmatic solution:
                      // hard-reload with the suggestion as the only origin
                      // by calling the parent through a custom event.
                      window.dispatchEvent(new CustomEvent('arm-swap-origin', {
                        detail: { iata: s.iata },
                      }));
                    }}
                  >
                    <strong>{s.name}</strong>
                    <span className="arm-suggestion-meta">
                      {s.distanceKm} km · {s.routeCount} routes
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <button className="rm-btn" onClick={onBack}>Back to search</button>
        </div>
      )}

      {/* Side panel / bottom sheet for selected destination */}
      {panel && (
        <DestinationPanel
          panel={panel}
          familyName={familyName}
          date={date}
          passengers={passengers}
          directOnly={directOnly}
          isMobile={isMobile}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

// ── Canvas: geodesic arcs, one per route, coloured by origin ──────────────
function mountArcCanvas(map, destsRef, originByIataRef, originColorRef, filteredOriginRef) {
  const pane = map.getPanes().overlayPane;
  const canvas = document.createElement('canvas');
  canvas.className = 'rm-baseline-canvas';
  if (pane.firstChild) pane.insertBefore(canvas, pane.firstChild);
  else pane.appendChild(canvas);

  let resolved = []; // [{dep, arr, color}]

  const setRoutes = (routes, dests) => {
    const destMap = new Map();
    (dests || []).forEach(d => destMap.set(d.iata, d));
    resolved = (routes || []).map(r => {
      const origin = originByIataRef.current.get(r.dep);
      const dest   = destMap.get(r.arr);
      if (!origin || !dest) return null;
      return {
        lat1: origin.lat, lon1: origin.lon,
        lat2: dest.lat,   lon2: dest.lon,
        dep: r.dep,
        arr: r.arr,
        color: originColorRef.current.get(r.dep) || 'rgba(255,255,255,0.5)',
      };
    }).filter(Boolean);
  };

  const redraw = () => {
    // Always rebuild `resolved` from the latest refs — cheap and removes
    // the need for the caller to remember to call setRoutes.
    // We read the up-to-date routes from a ref held on the canvas itself.
    if (canvas._routes) setRoutes(canvas._routes, destsRef.current);

    const size = map.getSize();
    canvas.width  = size.x;
    canvas.height = size.y;
    const tl = map.containerPointToLayerPoint([0, 0]);
    canvas.style.transform = `translate(${tl.x}px,${tl.y}px)`;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.x, size.y);
    if (!resolved.length) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Batch per colour: single beginPath/stroke per colour bucket.
    const filter = filteredOriginRef.current;
    const buckets = new Map(); // color → [[lat1,lon1,lat2,lon2,dim]]
    for (const r of resolved) {
      const dim = filter && r.dep !== filter;
      const key = dim ? `${r.color}::dim` : r.color;
      if (!buckets.has(key)) buckets.set(key, { color: r.color, dim, lines: [] });
      buckets.get(key).lines.push(r);
    }

    // Draw dimmed first so bright ones render on top.
    const sorted = Array.from(buckets.values()).sort((a, b) => (a.dim ? 0 : 1) - (b.dim ? 0 : 1));

    for (const bucket of sorted) {
      ctx.globalAlpha = bucket.dim ? 0.12 : 0.85;
      ctx.strokeStyle = bucket.color;
      ctx.lineWidth = bucket.dim ? 1 : 1.8;
      ctx.beginPath();
      for (const r of bucket.lines) {
        const pts = geodesicPoints(r.lat1, r.lon1, r.lat2, r.lon2, 60);
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
        for (let k = 1; k < proj.length; k++) ctx.lineTo(proj[k].x, proj[k].y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // Allow parent to push routes in by stashing on the canvas element; a
  // subsequent redraw() picks them up. This avoids a rebuild-layer dance
  // whenever the data prop changes.
  const setData = (routes) => { canvas._routes = routes; redraw(); };

  map.on('move zoom viewreset resize', redraw);

  return {
    canvas,
    redraw: () => { redraw(); },
    setData,
    remove: () => {
      map.off('move zoom viewreset resize', redraw);
      canvas.remove();
    },
  };
}

// ── Canvas: origin dots (large, labelled) + destination dots (small) ──────
function mountDotsCanvas(map, destsRef, originByIataRef, originColorRef, filteredOriginRef) {
  const pane = map.getPanes().overlayPane;
  const canvas = document.createElement('canvas');
  canvas.className = 'rm-airport-canvas';
  pane.appendChild(canvas);

  const redraw = () => {
    const size = map.getSize();
    canvas.width  = size.x;
    canvas.height = size.y;
    const tl = map.containerPointToLayerPoint([0, 0]);
    canvas.style.transform = `translate(${tl.x}px,${tl.y}px)`;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.x, size.y);
    const filter = filteredOriginRef.current;

    // Destination dots (draw first so origins render above).
    const dests = destsRef.current || [];
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.strokeStyle = 'rgba(14,14,30,0.9)';
    ctx.lineWidth = 1.5;
    for (const d of dests) {
      const pt = map.latLngToContainerPoint([d.lat, d.lon]);
      if (pt.x < -10 || pt.x > size.x + 10 || pt.y < -10 || pt.y > size.y + 10) continue;
      const r = 3;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Origin dots.
    const origins = Array.from(originByIataRef.current.values());
    for (const o of origins) {
      const pt = map.latLngToContainerPoint([o.lat, o.lon]);
      if (pt.x < -20 || pt.x > size.x + 20 || pt.y < -20 || pt.y > size.y + 20) continue;
      const dim = filter && o.iata !== filter;
      const color = originColorRef.current.get(o.iata) || '#fff';
      const r = dim ? 5 : 7;
      ctx.globalAlpha = dim ? 0.4 : 1;

      // Halo
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r + 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = dim ? 0.08 : 0.2;
      ctx.fill();

      // Core
      ctx.globalAlpha = dim ? 0.5 : 1;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Outline
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(14,14,30,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // IATA label
      ctx.globalAlpha = dim ? 0.5 : 1;
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const labelX = pt.x + r + 6;
      const labelY = pt.y;
      const text = o.iata;
      const textW = ctx.measureText(text).width;
      // Shadowed pill for legibility.
      ctx.fillStyle = 'rgba(14,14,30,0.78)';
      ctx.fillRect(labelX - 3, labelY - 8, textW + 6, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, labelX, labelY);
      ctx.globalAlpha = 1;
    }
  };

  map.on('move zoom viewreset resize', redraw);
  redraw();

  const hitTest = (containerPt, tol = 16) => {
    let best = null, bestD = tol;
    // Origins first (larger hit targets, semantically primary).
    for (const o of originByIataRef.current.values()) {
      const pt = map.latLngToContainerPoint([o.lat, o.lon]);
      const d = Math.hypot(pt.x - containerPt.x, pt.y - containerPt.y);
      if (d < bestD) {
        bestD = d;
        best = { type: 'origin', iata: o.iata, name: o.name };
      }
    }
    const destTol = 14;
    for (const d of destsRef.current || []) {
      const pt = map.latLngToContainerPoint([d.lat, d.lon]);
      const dd = Math.hypot(pt.x - containerPt.x, pt.y - containerPt.y);
      if (dd < destTol && dd < bestD) {
        bestD = dd;
        best = { type: 'dest', iata: d.iata, name: d.iata };
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

// ── Destination panel: runs the existing SSE search for this one origin ──
function DestinationPanel({ panel, familyName, date, passengers, directOnly, isMobile, onClose }) {
  const { results, progress, pct, status, error, search, cancel } = useAircraftSearch();

  useEffect(() => {
    search({
      familyName,
      iata: panel.dep,
      date: date || null,
      passengers: passengers || 1,
      nonStop: directOnly,
      // Radius omitted on purpose — we already know the exact origin.
    });
    return () => cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.dep, panel.arr]);

  // Filter results to only the chosen arrival — the stream returns flights
  // from all destinations of this origin.
  const filtered = results.filter(f => f.destination === panel.arr);

  return (
    <div className={`arm-panel${isMobile ? ' arm-panel--sheet' : ''}`}>
      <div className="arm-panel-header">
        <div className="arm-panel-route">
          <span className="arm-panel-iata">{panel.dep}</span>
          <span className="arm-panel-arrow">→</span>
          <span className="arm-panel-iata">{panel.arr}</span>
        </div>
        <button className="arm-panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      {familyName && <div className="arm-panel-family">{familyName}</div>}

      {status === 'searching' && (
        <div className="ac-progress arm-panel-progress">
          <div className="ac-progress-header">
            <span className="ac-progress-label">
              {progress?.phase === 'resolving_airports'
                ? 'Finding airports…'
                : `Scanning ${progress?.completed ?? 0} / ${progress?.total ?? '…'}`}
            </span>
            <span className="ac-progress-pct">{pct}%</span>
          </div>
          <div className="ac-progress-bar">
            <div className="ac-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {status === 'error' && <div className="ac-error">{error}</div>}

      {status === 'done' && filtered.length === 0 && (
        <div className="ac-empty">
          <span className="ac-empty-icon">✈</span>
          <p>No {familyName} flights found on {panel.dep} → {panel.arr}.</p>
          <p className="ac-empty-hint">This route has been seen recently but has no bookable flight on this date.</p>
        </div>
      )}

      <div className="ac-cards arm-panel-cards">
        {filtered.map((f, i) => (
          <AircraftFlightCard
            key={`${f.origin}-${f.destination}-${f.departureTime}-${i}`}
            flight={f}
            passengers={passengers}
            source="by-aircraft-panel"
          />
        ))}
      </div>
    </div>
  );
}


import { useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '../../utils/api';
import './SafetyGlobal.css';

const SafetyGlobalMap = lazy(() => import('./SafetyGlobalMap'));

const PAGE_SIZE   = 25;
const GLOBAL_BASE = `${API_BASE}/api/safety/global`;
const ERA_MIN     = 1980;
const ERA_MAX     = new Date().getFullYear();
const ERA_DEFAULT = [2000, ERA_MAX];

// Parse a fatalities string like "0", "15", "Unknown", "15+2" into a number.
// Returns 0 for "Unknown" / NaN — used only to drive the "fatal" filter, so
// erring towards "not fatal" on parse failure is the safe call.
function fatalityCount(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s || /^unknown$/i.test(s)) return 0;
  const parts = s.match(/\d+/g);
  if (!parts) return 0;
  return parts.reduce((acc, n) => acc + parseInt(n, 10), 0);
}

function firstUrl(raw) {
  if (!raw) return null;
  const first = String(raw).split(',')[0].trim();
  return first || null;
}

// Render-time filter applied to the in-memory map points array. Per UX spec
// the map controls (severity / era / model search) MUST cull the rendered
// set, not just dim non-matches — at world zoom dimming is invisible.
function applyMapFilters(points, { fatal, nonFatal, eraMin, eraMax, modelQuery }) {
  if (!Array.isArray(points)) return [];
  const q = (modelQuery || '').trim().toLowerCase();
  return points.filter(p => {
    const fc = fatalityCount(p.fatalities);
    if (fc > 0 && !fatal) return false;
    if (fc === 0 && !nonFatal) return false;
    if (p.year != null && (p.year < eraMin || p.year > eraMax)) return false;
    if (q && !(p.model || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

export default function SafetyGlobal() {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── URL-persistent filter state ────────────────────────────────────
  // ?fatal=0/1 (default 1), ?nonfatal=0/1 (default 1), ?era=YYYY-YYYY,
  // ?aircraft=<query>, ?selected=<accident-id>, ?offset=<table-offset>.
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
  const fatal     = (searchParams.get('fatal')    ?? '1') !== '0';
  const nonFatal  = (searchParams.get('nonfatal') ?? '1') !== '0';
  const modelQuery = searchParams.get('aircraft') || '';
  const selectedId = (() => {
    const v = parseInt(searchParams.get('selected') || '', 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  })();
  const [eraMinRaw, eraMaxRaw] = (() => {
    const raw = searchParams.get('era') || '';
    const m = /^(\d{4})-(\d{4})$/.exec(raw);
    if (!m) return ERA_DEFAULT;
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a < ERA_MIN || a > ERA_MAX || b < ERA_MIN || b > ERA_MAX || a > b) return ERA_DEFAULT;
    return [a, b];
  })();
  const eraMin = eraMinRaw, eraMax = eraMaxRaw;

  // ── Data fetching ──────────────────────────────────────────────────
  const [accidents, setAccidents]       = useState(null);
  const [accidentsErr, setAccidentsErr] = useState(null);
  const [mapPoints, setMapPoints]   = useState(null);
  const [mapErr, setMapErr]         = useState(null);
  const [topAircraft, setTopAircraft] = useState(null);
  const [topOperators, setTopOperators] = useState(null);
  const [statsErr, setStatsErr] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [selectedErr, setSelectedErr] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile bottom sheet

  // Table page (independent of map filters per UX spec).
  const [fatalOnly, setFatalOnly] = useState(false);

  useEffect(() => {
    let active = true;
    setAccidents(null);
    setAccidentsErr(null);
    fetch(`${GLOBAL_BASE}/accidents?limit=${PAGE_SIZE}&offset=${offset}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(body => { if (active) setAccidents(Array.isArray(body?.data) ? body.data : []); })
      .catch(err => { if (active) setAccidentsErr(err.message); });
    return () => { active = false; };
  }, [offset]);

  // map_data fetched once on mount (filters cull client-side)
  useEffect(() => {
    let active = true;
    fetch(`${GLOBAL_BASE}/map_data`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { if (active) setMapPoints(Array.isArray(data) ? data : []); })
      .catch(err => { if (active) setMapErr(err.message); });
    return () => { active = false; };
  }, []);

  // Stats refetch whenever commercialOnly toggles. After the NTSB CAROL
  // bulk import the default top-10 is U.S. general aviation (Cessna 172,
  // Piper PA-18) — true but irrelevant to a flight-search audience that
  // only books commercial. The toggle flips between "all" and "commercial"
  // (NTSB Part 121/125/129/135 + brand-prefix matched non-NTSB rows).
  const commercialOnly = (searchParams.get('commercial') ?? '1') !== '0';
  useEffect(() => {
    let active = true;
    setStatsErr(null);
    setTopAircraft(null);
    setTopOperators(null);
    const qs = commercialOnly ? '?commercial=1' : '';
    Promise.all([
      fetch(`${GLOBAL_BASE}/stats/aircrafts${qs}`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      fetch(`${GLOBAL_BASE}/stats/operators${qs}`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
    ])
      .then(([air, ops]) => {
        if (!active) return;
        setTopAircraft(Array.isArray(air) ? air : []);
        setTopOperators(Array.isArray(ops) ? ops : []);
      })
      .catch(err => { if (active) setStatsErr(err.message); });
    return () => { active = false; };
  }, [commercialOnly]);

  // Fetch detail for the selected event whenever the URL ?selected= changes.
  // Cached locally by id so re-clicking the same marker is instant.
  const [detailCache] = useState(() => new Map());
  useEffect(() => {
    if (!selectedId) { setSelectedDetail(null); setSelectedErr(null); return; }
    if (detailCache.has(selectedId)) {
      setSelectedDetail(detailCache.get(selectedId));
      setSelectedErr(null);
      return;
    }
    let active = true;
    setSelectedDetail(null);
    setSelectedErr(null);
    fetch(`${GLOBAL_BASE}/accidents/${selectedId}`)
      .then(r => {
        if (r.status === 404) throw new Error('not-found');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!active) return;
        detailCache.set(selectedId, data);
        setSelectedDetail(data);
      })
      .catch(err => { if (active) setSelectedErr(err.message); });
    return () => { active = false; };
  }, [selectedId, detailCache]);

  // ── URL helpers — small wrappers to keep filter state in the address bar ──
  const updateParams = useCallback((mut) => {
    const sp = new URLSearchParams(searchParams);
    mut(sp);
    setSearchParams(sp);
  }, [searchParams, setSearchParams]);

  const setCommercialOnly = (v) => updateParams(sp => {
    if (v) sp.delete('commercial'); else sp.set('commercial', '0');
  });
  const setFatal     = (v) => updateParams(sp => v ? sp.delete('fatal')    : sp.set('fatal', '0'));
  const setNonFatal  = (v) => updateParams(sp => v ? sp.delete('nonfatal') : sp.set('nonfatal', '0'));
  const setModelQuery = (v) => updateParams(sp => v ? sp.set('aircraft', v) : sp.delete('aircraft'));
  const setEra = (lo, hi) => updateParams(sp => {
    if (lo === ERA_DEFAULT[0] && hi === ERA_DEFAULT[1]) sp.delete('era');
    else sp.set('era', `${lo}-${hi}`);
  });
  const setSelected = useCallback((id) => updateParams(sp => {
    if (id) sp.set('selected', String(id)); else sp.delete('selected');
  }), [updateParams]);
  const goToOffset = (next) => updateParams(sp => {
    const safe = Math.max(0, next);
    if (safe === 0) sp.delete('offset'); else sp.set('offset', String(safe));
  });
  const resetFilters = () => updateParams(sp => {
    ['fatal', 'nonfatal', 'aircraft', 'era', 'selected'].forEach(k => sp.delete(k));
  });

  // ── Derived data ──────────────────────────────────────────────────
  const filteredPoints = useMemo(() => applyMapFilters(mapPoints, {
    fatal, nonFatal, eraMin, eraMax, modelQuery,
  }), [mapPoints, fatal, nonFatal, eraMin, eraMax, modelQuery]);

  const filtersDirty =
    !fatal || !nonFatal || modelQuery !== '' ||
    eraMin !== ERA_DEFAULT[0] || eraMax !== ERA_DEFAULT[1];

  const visibleRows = useMemo(() => {
    if (!accidents) return null;
    if (!fatalOnly) return accidents;
    return accidents.filter(a => fatalityCount(a.fatalities) > 0);
  }, [accidents, fatalOnly]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const hasNext = (accidents?.length || 0) === PAGE_SIZE;

  // ── Render ────────────────────────────────────────────────────────
  const detailUrl = selectedDetail ? firstUrl(selectedDetail.source_url) : null;
  const detailFatal = selectedDetail ? fatalityCount(selectedDetail.fatalities) : 0;

  return (
    <main className="safety-global">
      <header className="safety-global__header">
        <h1>Global aviation safety</h1>
        <p>
          Aggregated from the Aviation Safety Network, B3A, and Wikidata.
          Updated weekly. Read-only reference dataset of accidents and
          incidents worldwide — alongside the{' '}
          <a href="/safety/feed">NTSB feed</a> for U.S. official records.
        </p>
        <p className="safety-global__context">
          Commercial aviation flies roughly <strong>100,000 flights per
          day</strong>; the global fatal accident rate has averaged about{' '}
          <strong>one per million flights</strong> in the past decade
          (IATA, 2024). The events below are the rare, recorded ones.
        </p>
      </header>

      {/* Commercial-only toggle. Default ON because the alternative (full
          dataset) is dominated by U.S. general aviation (Cessna 172, Piper
          PA-18) which is true but irrelevant to a flight-search audience.
          ?commercial=0 in the URL flips to the unfiltered view for
          aviation researchers / curious browsers. */}
      <div className="safety-global__stats-mode" role="group" aria-label="Stats scope">
        <button
          type="button"
          className={`safety-global__mode-btn ${commercialOnly ? 'is-active' : ''}`}
          aria-pressed={commercialOnly}
          onClick={() => setCommercialOnly(true)}
        >
          Commercial only
        </button>
        <button
          type="button"
          className={`safety-global__mode-btn ${!commercialOnly ? 'is-active' : ''}`}
          aria-pressed={!commercialOnly}
          onClick={() => setCommercialOnly(false)}
        >
          All aviation
        </button>
        <span className="safety-global__mode-hint">
          {commercialOnly
            ? 'Boeing/Airbus/Embraer + scheduled/charter operators. Reflects what flight-search users actually fly on.'
            : 'Full dataset including U.S. general aviation (private Cessnas, Pipers, helicopters).'}
        </span>
      </div>

      <section className="safety-global__stats" aria-label="Top accident statistics">
        <div className="safety-stat-card">
          <h2>Top 10 aircraft by accident count</h2>
          {statsErr && <p className="safety-global__error">Failed to load: {statsErr}</p>}
          {!statsErr && !topAircraft && <p className="safety-global__loading">Loading…</p>}
          {!statsErr && topAircraft && topAircraft.length === 0 && (
            <p className="safety-global__loading">No data.</p>
          )}
          {!statsErr && topAircraft && topAircraft.length > 0 && (
            <ol>
              {topAircraft.map((row, i) => (
                <li key={`${row.name}-${i}`}>
                  <span className="safety-stat-rank">{i + 1}</span>
                  <span className="safety-stat-name">{row.name}</span>
                  <span className="safety-stat-count">{row.count} events</span>
                  <span className="safety-stat-fatal">{row.fatalities ?? 0} fatal.</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="safety-stat-card">
          <h2>Top 10 operators by accident count</h2>
          {statsErr && <p className="safety-global__error">Failed to load: {statsErr}</p>}
          {!statsErr && !topOperators && <p className="safety-global__loading">Loading…</p>}
          {!statsErr && topOperators && topOperators.length === 0 && (
            <p className="safety-global__loading">No data.</p>
          )}
          {!statsErr && topOperators && topOperators.length > 0 && (
            <ol>
              {topOperators.map((row, i) => (
                <li key={`${row.name}-${i}`}>
                  <span className="safety-stat-rank">{i + 1}</span>
                  <span className="safety-stat-name">{row.name}</span>
                  <span className="safety-stat-count">{row.count} events</span>
                  <span className="safety-stat-fatal">{row.fatalities ?? 0} fatal.</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* ── Map section with overlay controls + optional side panel ── */}
      <section className="safety-global__map-section" aria-label="Accident locations map">
        <h2>Geocoded accident locations</h2>
        <p className="safety-global__map-hint">
          {mapPoints
            ? `Showing ${filteredPoints.length.toLocaleString()} of ${mapPoints.length.toLocaleString()} geocoded events. Coordinates are available for ~18% of records — the rest are pending geocoding.`
            : 'Loading…'}
        </p>

        {mapErr && <p className="safety-global__error">Map failed to load: {mapErr}</p>}

        {!mapErr && (
          <div className={`safety-global__map-stage ${selectedId ? 'is-detail-open' : ''}`}>
            <Suspense
              fallback={
                <div className="safety-global__map safety-global__map--loading" aria-label="Loading map">
                  <span>Loading map&hellip;</span>
                </div>
              }
            >
              <SafetyGlobalMap
                points={filteredPoints}
                selectedId={selectedId}
                onSelect={setSelected}
              />
            </Suspense>

            {/* Filters overlay (desktop = always visible; mobile = bottom sheet via filtersOpen) */}
            <div className={`safety-global__filters ${filtersOpen ? 'is-open' : ''}`}>
              <div className="safety-global__filters-head">
                <strong>Filters</strong>
                {filtersDirty && (
                  <button type="button" className="safety-global__reset-btn" onClick={resetFilters}>
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  className="safety-global__filters-close"
                  onClick={() => setFiltersOpen(false)}
                  aria-label="Close filters"
                >×</button>
              </div>

              <fieldset className="safety-global__filter-group">
                <legend>Severity</legend>
                <label className="safety-global__chip">
                  <input type="checkbox" checked={fatal} onChange={e => setFatal(e.target.checked)} />
                  <span><span className="dot dot--fatal" /> Fatal</span>
                </label>
                <label className="safety-global__chip">
                  <input type="checkbox" checked={nonFatal} onChange={e => setNonFatal(e.target.checked)} />
                  <span><span className="dot dot--nonfatal" /> Non-fatal</span>
                </label>
              </fieldset>

              <fieldset className="safety-global__filter-group">
                <legend>Era: {eraMin}–{eraMax}</legend>
                <div className="safety-global__era-row">
                  <input
                    type="range"
                    min={ERA_MIN}
                    max={ERA_MAX}
                    step={1}
                    value={eraMin}
                    onChange={e => {
                      const lo = Math.min(parseInt(e.target.value, 10), eraMax);
                      setEra(lo, eraMax);
                    }}
                    aria-label="Era start year"
                  />
                  <input
                    type="range"
                    min={ERA_MIN}
                    max={ERA_MAX}
                    step={1}
                    value={eraMax}
                    onChange={e => {
                      const hi = Math.max(parseInt(e.target.value, 10), eraMin);
                      setEra(eraMin, hi);
                    }}
                    aria-label="Era end year"
                  />
                </div>
              </fieldset>

              <fieldset className="safety-global__filter-group">
                <legend>Aircraft model</legend>
                <input
                  type="search"
                  className="safety-global__search"
                  placeholder="e.g. 737, A320, Cessna"
                  value={modelQuery}
                  onChange={e => setModelQuery(e.target.value)}
                  aria-label="Aircraft model search"
                />
              </fieldset>
            </div>

            {/* Mobile-only floating button to open the filter sheet */}
            <button
              type="button"
              className="safety-global__filters-fab"
              onClick={() => setFiltersOpen(true)}
              aria-label={`Filters${filtersDirty ? ' (active)' : ''}`}
            >
              ☰ Filters{filtersDirty ? ' •' : ''}
            </button>

            {/* Side / bottom sheet for the selected accident */}
            {selectedId && (
              <aside className="safety-global__detail" aria-label="Selected accident detail">
                <div className="safety-global__detail-head">
                  {selectedDetail && (
                    <span className={`safety-global__sev-badge ${detailFatal > 0 ? 'is-fatal' : ''}`}>
                      {detailFatal > 0 ? 'Fatal' : 'Non-fatal'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="safety-global__detail-close"
                    onClick={() => setSelected(null)}
                    aria-label="Close detail"
                  >×</button>
                </div>

                {!selectedDetail && !selectedErr && (
                  <p className="safety-global__loading">Loading record…</p>
                )}
                {selectedErr === 'not-found' && (
                  <p className="safety-global__error">
                    This record was removed from the dataset. Refresh the map to update.
                  </p>
                )}
                {selectedErr && selectedErr !== 'not-found' && (
                  <p className="safety-global__error">Failed to load: {selectedErr}</p>
                )}

                {selectedDetail && (
                  <>
                    <p className="safety-global__detail-date">{selectedDetail.date || 'Date unknown'}</p>
                    <h3 className="safety-global__detail-aircraft">
                      {selectedDetail.aircraft_model || 'Unknown aircraft'}
                    </h3>
                    {selectedDetail.operator && (
                      <p className="safety-global__detail-line">
                        Operator: {selectedDetail.operator}
                      </p>
                    )}
                    {selectedDetail.location && (
                      <p className="safety-global__detail-line">
                        Location: {selectedDetail.location}
                      </p>
                    )}
                    {selectedDetail.fatalities && selectedDetail.fatalities !== '0' && (
                      <p className="safety-global__detail-line">
                        Fatalities: <strong>{selectedDetail.fatalities}</strong>
                      </p>
                    )}
                    {detailUrl && (
                      <p className="safety-global__detail-line">
                        <a
                          href={detailUrl}
                          target="_blank"
                          rel="nofollow noopener noreferrer"
                          className="safety-global__detail-source"
                        >
                          Read source report →
                        </a>
                      </p>
                    )}
                  </>
                )}
              </aside>
            )}

            {/* Empty state — nothing matches the current filter combo */}
            {filteredPoints.length === 0 && mapPoints && mapPoints.length > 0 && (
              <div className="safety-global__map-empty">
                <p>No accidents match your filters.</p>
                <button type="button" className="safety-global__reset-btn" onClick={resetFilters}>
                  Reset filters
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Table (independent of map filters per UX spec) ──────────── */}
      <section className="safety-global__table-section" aria-label="Accident records">
        <h2>All recorded accidents</h2>

        <div className="safety-global__filter-row">
          <label>
            <input
              type="checkbox"
              checked={fatalOnly}
              onChange={e => setFatalOnly(e.target.checked)}
            />
            Show only fatal events
          </label>
          {visibleRows && (
            <span className="safety-global__count">
              Showing {visibleRows.length}
              {fatalOnly && accidents ? ` of ${accidents.length}` : ''} on this page
            </span>
          )}
        </div>

        {accidentsErr && <p className="safety-global__error">Failed to load: {accidentsErr}</p>}
        {!accidentsErr && !accidents && <p className="safety-global__loading">Loading accidents…</p>}

        {!accidentsErr && visibleRows && visibleRows.length === 0 && (
          <p className="safety-global__loading">
            {fatalOnly
              ? 'No fatal events on this page. Try the next page or remove the filter.'
              : 'No records on this page.'}
          </p>
        )}

        {!accidentsErr && visibleRows && visibleRows.length > 0 && (
          <div className="safety-global__table-wrap">
            <table className="safety-global__table">
              <caption className="safety-global__sr-only">
                Aviation accidents worldwide — date, aircraft, operator, location, fatalities, source.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Aircraft</th>
                  <th scope="col">Operator</th>
                  <th scope="col">Location</th>
                  <th scope="col">Fatalities</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => {
                  const fc = fatalityCount(row.fatalities);
                  const url = firstUrl(row.source_url);
                  return (
                    <tr key={row.id}>
                      <td>{row.date || '—'}</td>
                      <td>{row.aircraft_model || '—'}</td>
                      <td>{row.operator || '—'}</td>
                      <td>{row.location || '—'}</td>
                      <td>
                        {fc > 0
                          ? <span className="safety-global__fatal">{row.fatalities}</span>
                          : <span className="safety-global__zero">{row.fatalities || '0'}</span>}
                      </td>
                      <td>
                        {url
                          ? <a href={url} rel="nofollow noopener noreferrer" target="_blank">link</a>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="safety-global__pager">
          <span className="safety-global__pager-info">
            Page {page} · offset {offset.toLocaleString()}
          </span>
          <div className="safety-global__pager-btns">
            <button
              type="button"
              className="safety-global__pager-btn"
              onClick={() => goToOffset(offset - PAGE_SIZE)}
              disabled={offset === 0}
            >
              ← Previous
            </button>
            <button
              type="button"
              className="safety-global__pager-btn"
              onClick={() => goToOffset(offset + PAGE_SIZE)}
              disabled={!hasNext}
            >
              Next →
            </button>
          </div>
        </div>
      </section>

      <p className="safety-global__honesty">
        Some records have unknown dates (&ldquo;xx Oct 2024&rdquo;) because not
        all sources publish exact days. Coordinates are available for ~18% of
        records — the rest are pending geocoding and don&rsquo;t appear on the
        map yet. Counts may differ slightly from the original sources because
        we deduplicate cross-listed events.
      </p>
    </main>
  );
}

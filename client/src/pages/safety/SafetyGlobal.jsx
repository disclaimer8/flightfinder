import { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '../../utils/api';
import './SafetyGlobal.css';

const SafetyGlobalMap = lazy(() => import('./SafetyGlobalMap'));

const PAGE_SIZE = 25;
const GLOBAL_BASE = `${API_BASE}/api/safety/global`;

// Parse a fatalities string like "0", "15", "Unknown", "15+2" into a number.
// Returns 0 for "Unknown" / NaN — used only to drive the "fatal" filter, so
// erring towards "not fatal" on parse failure is the safe call.
function fatalityCount(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s || /^unknown$/i.test(s)) return 0;
  // Sum digit groups separated by '+': "15+2" → 17.
  const parts = s.match(/\d+/g);
  if (!parts) return 0;
  return parts.reduce((acc, n) => acc + parseInt(n, 10), 0);
}

// First URL of a possibly comma-separated source_url field.
function firstUrl(raw) {
  if (!raw) return null;
  const first = String(raw).split(',')[0].trim();
  return first || null;
}

export default function SafetyGlobal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

  const [accidents, setAccidents]       = useState(null); // current page slice
  const [accidentsErr, setAccidentsErr] = useState(null);

  const [mapPoints, setMapPoints]   = useState(null);
  const [mapErr, setMapErr]         = useState(null);

  const [topAircraft, setTopAircraft] = useState(null);
  const [topOperators, setTopOperators] = useState(null);
  const [statsErr, setStatsErr] = useState(null);

  const [fatalOnly, setFatalOnly] = useState(false);

  // Fetch one page of accidents whenever offset changes.
  useEffect(() => {
    let active = true;
    setAccidents(null);
    setAccidentsErr(null);
    fetch(`${GLOBAL_BASE}/accidents?limit=${PAGE_SIZE}&offset=${offset}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(body => { if (active) setAccidents(Array.isArray(body?.data) ? body.data : []); })
      .catch(err => { if (active) setAccidentsErr(err.message); });
    return () => { active = false; };
  }, [offset]);

  // Fetch map points + top stats once on mount.
  useEffect(() => {
    let active = true;

    fetch(`${GLOBAL_BASE}/map_data`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { if (active) setMapPoints(Array.isArray(data) ? data : []); })
      .catch(err => { if (active) setMapErr(err.message); });

    Promise.all([
      fetch(`${GLOBAL_BASE}/stats/aircrafts`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      fetch(`${GLOBAL_BASE}/stats/operators`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
    ])
      .then(([air, ops]) => {
        if (!active) return;
        setTopAircraft(Array.isArray(air) ? air : []);
        setTopOperators(Array.isArray(ops) ? ops : []);
      })
      .catch(err => { if (active) setStatsErr(err.message); });

    return () => { active = false; };
  }, []);

  // Client-side fatal filter on the current page.
  const visibleRows = useMemo(() => {
    if (!accidents) return null;
    if (!fatalOnly) return accidents;
    return accidents.filter(a => fatalityCount(a.fatalities) > 0);
  }, [accidents, fatalOnly]);

  const goToOffset = (next) => {
    const safe = Math.max(0, next);
    if (safe === 0) {
      const sp = new URLSearchParams(searchParams);
      sp.delete('offset');
      setSearchParams(sp);
    } else {
      const sp = new URLSearchParams(searchParams);
      sp.set('offset', String(safe));
      setSearchParams(sp);
    }
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const hasNext = (accidents?.length || 0) === PAGE_SIZE;

  return (
    <main className="safety-global">
      <header className="safety-global__header">
        <h1>Global aviation safety</h1>
        <p>
          Aggregated from the Aviation Safety Network, B3A, and Wikidata.
          Updated weekly. Read-only reference dataset of accidents and incidents
          worldwide — alongside the{' '}
          <a href="/safety/feed">NTSB feed</a> for U.S. official records.
        </p>
      </header>

      {/* ── Stats cards ─────────────────────────────────────── */}
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

      {/* ── Map ─────────────────────────────────────────────── */}
      <section className="safety-global__map-section">
        <h2>Geocoded accident locations</h2>
        <p className="safety-global__map-hint">
          {mapPoints
            ? `${mapPoints.length.toLocaleString()} events with known coordinates. Hover any dot for aircraft type and fatalities.`
            : 'Loading…'}
        </p>
        {mapErr && <p className="safety-global__error">Map failed to load: {mapErr}</p>}
        {!mapErr && (
          <Suspense fallback={<div className="safety-global__map" aria-label="Loading map" />}>
            <SafetyGlobalMap points={mapPoints || []} />
          </Suspense>
        )}
      </section>

      {/* ── Table ───────────────────────────────────────────── */}
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

        {accidentsErr && (
          <p className="safety-global__error">Failed to load: {accidentsErr}</p>
        )}
        {!accidentsErr && !accidents && (
          <p className="safety-global__loading">Loading accidents…</p>
        )}

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

import { useState, useMemo, useEffect } from 'react';
import AircraftFlightCard from './AircraftFlightCard';
import './AircraftSearchResults.css';

const PAGE_SIZE = 25;

/**
 * AircraftSearchResults
 *
 * Renders streaming aircraft-search results with a live progress bar,
 * client-side sorting, and 25-per-page pagination.
 *
 * Props:
 *   results    — array of flight objects (grow in real-time)
 *   progress   — { phase, airports?, completed, total } | null
 *   pct        — 0-100 percentage
 *   status     — 'idle' | 'searching' | 'done' | 'error'
 *   error      — string | null
 *   familyName — string — shown in heading
 *   passengers — integer — forwarded into the affiliate booking URL
 */
export default function AircraftSearchResults({ results, progress, pct, status, error, familyName, passengers }) {
  const [sortKey, setSortKey] = useState('price-asc');
  const [page, setPage]       = useState(1);

  const sorted = useMemo(() => sortResults(results, sortKey), [results, sortKey]);

  const totalPages  = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const pageSlice   = sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  // If the stream shrinks past the current page (e.g. a new search starts),
  // snap back to page 1 so we don't strand the user on an empty page.
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  if (status === 'idle') return null;

  const airports = progress?.airports;

  return (
    <div className="ac-results">
      {/* Progress area */}
      {status === 'searching' && (
        <div className="ac-progress">
          <div className="ac-progress-header">
            <span className="ac-progress-label">
              {progress?.phase === 'resolving_airports'
                ? 'Finding airports…'
                : `Searching ${progress?.completed ?? 0} / ${progress?.total ?? '…'} routes`}
            </span>
            <span className="ac-progress-pct">{pct}%</span>
          </div>
          <div className="ac-progress-bar">
            <div className="ac-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          {airports?.length > 0 && (
            <p className="ac-progress-airports">
              Searching from: {airports.map(a => `${a.iata} (${a.city})`).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="ac-error">{error}</div>
      )}

      {/* Toolbar: title + sort selector on one row */}
      {results.length > 0 && (
        <div className="ac-results-toolbar">
          <div className="ac-results-header">
            <h2 className="ac-results-title">
              {familyName} flights
              <span className="ac-results-count">{results.length} found{status === 'searching' ? '…' : ''}</span>
            </h2>
          </div>
          <label className="ac-sort-label">
            Sort by
            <select
              className="ac-sort-select"
              value={sortKey}
              onChange={e => { setSortKey(e.target.value); setPage(1); }}
              aria-label="Sort flights by"
            >
              <option value="price-asc">Price (low to high)</option>
              <option value="price-desc">Price (high to low)</option>
              <option value="duration-asc">Duration (shortest)</option>
              <option value="departure-asc">Departure (earliest)</option>
            </select>
          </label>
        </div>
      )}

      {/* Done + empty */}
      {status === 'done' && results.length === 0 && (
        <div className="ac-empty">
          <span className="ac-empty-icon">✈</span>
          <p>No {familyName} flights found.</p>
          <p className="ac-empty-hint">Try a larger city, wider radius, or a different date.</p>
        </div>
      )}

      {/* Flight cards (paginated slice) */}
      <div className="ac-cards">
        {pageSlice.map((f, i) => (
          <AircraftFlightCard
            key={`${f.origin}-${f.destination}-${f.departureTime}-${(pageClamped - 1) * PAGE_SIZE + i}`}
            flight={f}
            passengers={passengers}
            source="by-aircraft-card"
          />
        ))}
      </div>

      {/* Pager — hidden when everything fits on one page */}
      {totalPages > 1 && (
        <div className="ac-pager">
          <button
            type="button"
            className="ac-pager-btn"
            disabled={pageClamped <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="ac-pager-label">Page {pageClamped} of {totalPages}</span>
          <button
            type="button"
            className="ac-pager-btn"
            disabled={pageClamped >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sorting ────────────────────────────────────────────────────────────────
// All sorts are stable (.slice() → .sort()) and put malformed rows at the
// bottom by returning Infinity from the key function. Price sort accepts
// numeric strings like "123.45" which is what the backend emits today.
function sortResults(list, key) {
  const arr = list.slice();
  switch (key) {
    case 'price-asc':
      return arr.sort((a, b) => priceKey(a) - priceKey(b));
    case 'price-desc':
      return arr.sort((a, b) => priceKey(b) - priceKey(a));
    case 'duration-asc':
      return arr.sort((a, b) => durationKey(a) - durationKey(b));
    case 'departure-asc':
      return arr.sort((a, b) => departureKey(a) - departureKey(b));
    default:
      return arr;
  }
}

function priceKey(f) {
  const n = Number(f?.price);
  return Number.isFinite(n) ? n : Infinity;
}

// AircraftFlightCard renders `formatDuration(f.duration)` which matches
// /PT(?:(\d+)H)?(?:(\d+)M)?/ — so `duration` is an ISO 8601 string.
// Fall back to departure/arrival delta when parsing fails.
function durationKey(f) {
  const iso = parseIsoDurationMin(f?.duration);
  if (iso != null) return iso;
  const dep = f?.departureTime ? new Date(f.departureTime).getTime() : NaN;
  const arr = f?.arrivalTime   ? new Date(f.arrivalTime).getTime()   : NaN;
  if (Number.isFinite(dep) && Number.isFinite(arr) && arr > dep) {
    return (arr - dep) / 60000;
  }
  return Infinity;
}

function parseIsoDurationMin(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m || (!m[1] && !m[2])) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + min;
}

function departureKey(f) {
  const t = f?.departureTime ? new Date(f.departureTime).getTime() : NaN;
  return Number.isFinite(t) ? t : Infinity;
}

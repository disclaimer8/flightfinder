import './AircraftSearchResults.css';

/**
 * AircraftSearchResults
 *
 * Renders streaming aircraft-search results with a live progress bar.
 *
 * Props:
 *   results   — array of flight objects (grow in real-time)
 *   progress  — { phase, airports?, completed, total } | null
 *   pct       — 0-100 percentage
 *   status    — 'idle' | 'searching' | 'done' | 'error'
 *   error     — string | null
 *   familyName — string — shown in heading
 */
export default function AircraftSearchResults({ results, progress, pct, status, error, familyName }) {
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

      {/* Results heading */}
      {results.length > 0 && (
        <div className="ac-results-header">
          <h2 className="ac-results-title">
            {familyName} flights
            <span className="ac-results-count">{results.length} found{status === 'searching' ? '…' : ''}</span>
          </h2>
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

      {/* Flight cards */}
      <div className="ac-cards">
        {results.map((f, i) => (
          <div className="ac-card" key={`${f.origin}-${f.destination}-${f.departureTime}-${i}`}>
            <div className="ac-card-route">
              <span className="ac-card-iata">{f.origin}</span>
              <span className="ac-card-arrow">→</span>
              <span className="ac-card-iata">{f.destination}</span>
            </div>

            <div className="ac-card-meta">
              {f.aircraftCode && (
                <span className="ac-card-aircraft" title={f.aircraftName}>
                  ✈ {f.aircraftName || f.aircraftCode}
                </span>
              )}
              {f.airline && <span className="ac-card-airline">{f.airline}</span>}
              {f.duration && <span className="ac-card-duration">{formatDuration(f.duration)}</span>}
              {f.stops !== undefined && (
                <span className="ac-card-stops">{f.stops === 0 ? 'Direct' : `${f.stops} stop${f.stops > 1 ? 's' : ''}`}</span>
              )}
            </div>

            {f.departureTime && (
              <div className="ac-card-times">
                <span>{formatTime(f.departureTime)}</span>
                {f.arrivalTime && <><span className="ac-card-arrow">→</span><span>{formatTime(f.arrivalTime)}</span></>}
              </div>
            )}

            <div className="ac-card-price">
              <span className="ac-card-amount">{f.currency} {f.price}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

function formatDuration(iso) {
  // ISO 8601 duration: PT2H35M
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return iso;
  const h = m[1] ? `${m[1]}h ` : '';
  const min = m[2] ? `${m[2]}m` : '';
  return `${h}${min}`.trim();
}

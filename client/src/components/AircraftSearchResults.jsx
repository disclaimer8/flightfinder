import AircraftFlightCard from './AircraftFlightCard';
import './AircraftSearchResults.css';

/**
 * AircraftSearchResults
 *
 * Renders streaming aircraft-search results with a live progress bar.
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
          <AircraftFlightCard
            key={`${f.origin}-${f.destination}-${f.departureTime}-${i}`}
            flight={f}
            passengers={passengers}
            source="by-aircraft-card"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Single flight card for the by-aircraft flow. Used by
 * AircraftSearchResults and by the DestinationPanel inside
 * AircraftRouteMap — both need identical markup.
 *
 * Previously linked out to an Aviasales affiliate; now informational
 * only (subscription pivot — Plan 3). Downstream enrichment from the
 * Pro endpoint will be grafted in a followup if needed here.
 *
 * Props:
 *   flight — result row from the SSE stream
 */
export default function AircraftFlightCard({ flight }) {
  const f = flight;
  return (
    <div className="ac-card">
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
          <span className="ac-card-stops">
            {f.stops === 0 ? 'Direct' : `${f.stops} stop${f.stops > 1 ? 's' : ''}`}
          </span>
        )}
      </div>

      {f.departureTime && (
        <div className="ac-card-times">
          <span>{formatTime(f.departureTime)}</span>
          {f.arrivalTime && (
            <>
              <span className="ac-card-arrow">→</span>
              <span>{formatTime(f.arrivalTime)}</span>
            </>
          )}
        </div>
      )}

      {(f.price != null) && (
        <div className="ac-card-price">
          <span className="ac-card-amount">{f.currency} {f.price}</span>
        </div>
      )}
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
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return iso;
  const h = m[1] ? `${m[1]}h ` : '';
  const min = m[2] ? `${m[2]}m` : '';
  return `${h}${min}`.trim();
}

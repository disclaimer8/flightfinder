import { buildBookingUrl, emitAffiliateClick } from '../utils/booking';

/**
 * Single flight card for the by-aircraft flow. Used by
 * AircraftSearchResults and by the DestinationPanel inside
 * AircraftRouteMap — both need identical markup and identical
 * monetization behaviour, so they share this one component.
 *
 * Clicking the card (anywhere, whole surface) opens the Travelpayouts
 * affiliate redirect to Aviasales in a new tab. If required booking
 * fields are missing we fall back to a non-clickable card so the user
 * still sees the data but the dead-end is explicit.
 *
 * Props:
 *   flight     — result row from the SSE stream
 *   passengers — integer, forwarded into the booking URL (default 1)
 *   source     — 'by-aircraft-card' | 'by-aircraft-panel' (analytics tag)
 */
export default function AircraftFlightCard({ flight, passengers, source }) {
  const f = flight;
  const bookingUrl = buildBookingUrl(
    {
      origin: f.origin,
      destination: f.destination,
      departureTime: f.departureTime,
      airline: f.airline, // IATA in by-aircraft SSE shape → narrows Aviasales to this carrier
    },
    passengers
  );

  const onClick = () => emitAffiliateClick(source, {
    origin: f.origin,
    destination: f.destination,
    aircraftCode: f.aircraftCode,
    airline: f.airline,
    price: f.price,
    currency: f.currency,
    departureTime: f.departureTime,
  });

  const body = (
    <>
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

      <div className="ac-card-price">
        <span className="ac-card-amount">{f.currency} {f.price}</span>
        {bookingUrl ? (
          <span className="ac-card-cta">
            Search on Aviasales
            <svg aria-hidden="true" focusable="false" className="ac-card-cta-icon" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        ) : (
          <span className="ac-card-cta ac-card-cta--disabled">Booking unavailable</span>
        )}
      </div>
    </>
  );

  if (!bookingUrl) {
    return <div className="ac-card ac-card--dead">{body}</div>;
  }

  return (
    <a
      className="ac-card ac-card--link"
      href={bookingUrl}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={onClick}
      aria-label={`Search ${f.airline || ''} ${f.origin} to ${f.destination} on Aviasales (opens new tab)`}
    >
      {body}
    </a>
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

import EnrichedPanel from './EnrichedPanel';
import { useClientConfig } from '../hooks/useClientConfig';
import { amadeusToIcao } from '../utils/amadeusToIcao';

/**
 * Single flight card for the by-aircraft flow. Used by
 * AircraftSearchResults and by the DestinationPanel inside
 * AircraftRouteMap — both need identical markup.
 *
 * By-aircraft shows route + aircraft combos (not scheduled flights), so we
 * don't have a flight number. The enriched ID is `XX:YYYY-MM-DD` — server
 * still enriches weather, amenities, CO₂ and livery; gate/on-time skip
 * because they need a flight number.
 *
 * Props:
 *   flight — result row from the SSE stream
 */
export default function AircraftFlightCard({ flight }) {
  const f = flight;
  const { enrichedCardEnabled = true } = useClientConfig();

  // Synthesise a route-scoped id: "LX:2026-06-01" (no flight#).
  const airlineCode = (f.airlineIata || f.airline || '').toUpperCase();
  const depDate = (f.departureTime || '').slice(0, 10);
  const enrichedId = airlineCode.length === 2 && depDate
    ? `${airlineCode}:${depDate}`
    : null;
  const icaoType = amadeusToIcao(f.aircraftCode);

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

      {enrichedCardEnabled && enrichedId && (
        <EnrichedPanel
          flight={{
            id: enrichedId,
            airline: airlineCode,
            flightNumber: null,
            departure: { code: f.origin },
            arrival:   { code: f.destination },
            aircraft:  { icaoType, registration: null },
          }}
        />
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

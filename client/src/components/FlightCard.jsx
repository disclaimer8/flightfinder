import { Link } from 'react-router-dom';
import { formatTime, formatDate } from '../utils/formatters';
import EnrichedPanel from './EnrichedPanel';
import AddToTripsButton from './AddToTripsButton';
import OperatorSafetyBlock from './OperatorSafetyBlock';
import { useClientConfig } from '../hooks/useClientConfig';
import { amadeusToIcao } from '../utils/amadeusToIcao';
import { aircraftDisplayToFamilySlug } from '../utils/flightUtils';
import './FlightCard.css';

function ItineraryRow({ itinerary, label }) {
  const { departure, arrival, departureTime, arrivalTime, duration, stops, stopAirports, segments } = itinerary;
  const depDate = formatDate(departureTime);
  const arrDate = formatDate(arrivalTime);
  const dateChanged = depDate !== arrDate;

  return (
    <div className="itinerary-row">
      {label && <span className="itinerary-label">{label}</span>}

      <div className="route-line">
        <div className="endpoint">
          <span className="airport-code">{departure.code}</span>
          <span className="time">{formatTime(departureTime)}</span>
          <span className="date">{depDate}</span>
        </div>

        <div className="route-middle">
          <div className="route-path">
            <div className="line" />
            {(stopAirports || []).map(code => (
              <div
                key={code}
                className="stop-dot"
                role="img"
                aria-label={`Stopover: ${code}`}
              >
                <span className="stop-code" aria-hidden="true">{code}</span>
              </div>
            ))}
            <div className="line" />
          </div>
          <div className="route-meta">
            <span className="duration">{duration}</span>
            {stops > 0 ? (
              <span className="stops-badge">{stops} stop{stops > 1 ? 's' : ''}</span>
            ) : (
              <span className="nonstop-badge">Nonstop</span>
            )}
          </div>
        </div>

        <div className="endpoint end">
          <span className="airport-code">{arrival.code}</span>
          <span className="time">
            {formatTime(arrivalTime)}
            {dateChanged && <sup className="day-offset" aria-label="arrives next day">+1</sup>}
          </span>
          <span className="date">{arrDate}</span>
        </div>
      </div>

      {stops > 0 && (
        <div className="segments-detail">
          {(segments || []).map((seg, i) => (
            <span key={i} className="segment-pill">
              {seg.departure.code}→{seg.arrival.code} · {seg.flightNumber} · {seg.duration}
              {seg.aircraft?.name
                ? ` · ${seg.aircraft.name}`
                : seg.aircraftCode && seg.aircraftCode !== 'N/A'
                  ? ` · ${seg.aircraftCode}`
                  : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function FlightCard({ flight, showProTeaser = false }) {
  const { aircraft } = flight;
  const { enrichedCardEnabled = true, tripsEnabled = true } = useClientConfig();

  // Synthesize an id the enrichment endpoint accepts: "LX345:2026-05-15".
  // Search results return airline as the full name ("SWISS") and airlineIata
  // as the 2-letter code ("LX"); flightNumber is usually prefixed ("LX0345").
  // The server regex requires exactly 2-char airline + up to 4 digits, so we
  // prefer airlineIata and strip any leading alphabetic prefix from the number.
  // Backend stamps a deterministic flight.id (`${IATA}${digits}:${date}`)
  // so the FE no longer has to derive one. We keep the local synthesis as a
  // fallback for cached responses produced before the backend started
  // emitting the field. Anonymous fallback ids ("anon:...") aren't usable
  // as enrichment keys — treat them like a missing id.
  const depDate = (flight.departureTime || '').slice(0, 10);
  const airlineCode = (flight.airlineIata || flight.airline || '').toUpperCase();
  const flightDigits = String(flight.flightNumber || '')
    .replace(/^[A-Z]+/i, '')   // drop leading airline code if present
    .replace(/\D/g, '')        // keep digits only
    .replace(/^0+/, '');        // trim leading zeros: LX0345 -> 345
  const syntheticId = airlineCode.length === 2 && flightDigits && depDate
    ? `${airlineCode}${flightDigits}:${depDate}`
    : null;
  const backendId = flight.id && !String(flight.id).startsWith('anon:') ? flight.id : null;
  const enrichedId = backendId || syntheticId;

  const outboundItinerary = {
    departure: flight.departure,
    arrival: flight.arrival,
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    duration: flight.duration,
    stops: flight.stops ?? 0,
    stopAirports: flight.stopAirports ?? [],
    segments: flight.segments ?? [],
  };

  return (
    <>
    <div className="flight-card">
      <div className="flight-header">
        <div className="airline-info">
          <h3>{flight.airline}</h3>
          <span className="flight-number">{flight.flightNumber}</span>
        </div>
        <div className="price-block">
          <span className="price">
            {flight.currency === 'EUR' ? '€' : '$'}{flight.price}
          </span>
          <span className="price-note">
            {flight.isRoundTrip ? 'round-trip' : 'one-way'} · per person
          </span>
        </div>
      </div>

      <div className="itineraries">
        <ItineraryRow
          itinerary={outboundItinerary}
          label={flight.isRoundTrip ? 'Outbound' : null}
        />
        {flight.isRoundTrip && flight.returnItinerary && (
          <ItineraryRow itinerary={flight.returnItinerary} label="Return" />
        )}
      </div>

      <div className="flight-footer">
        <div className="aircraft-block">
          <span className="aircraft-name">{aircraft?.name || flight.aircraftName || flight.aircraftCode}</span>
          {/* Discreet cross-link to the aircraft landing page, which carries
              the safety section with proper context (overview, operators,
              fleet usage) — see UX rationale in the safety integration plan.
              We deliberately avoid surfacing raw accident counts on the card:
              counts without departure denominators mislead and inflate
              perceived risk (Slovic 1987; FAA/IATA report safety as rate per
              million departures, not absolute count). */}
          {(() => {
            const slug = aircraftDisplayToFamilySlug(
              aircraft?.name || flight.aircraftName || flight.aircraftCode
            );
            return slug ? (
              <Link
                to={`/aircraft/${slug}`}
                className="aircraft-safety-link"
                rel="nofollow"
              >
                View aircraft safety record →
              </Link>
            ) : null;
          })()}
          <span className={`type-badge type-${aircraft?.type || 'jet'}`}>
            {aircraft?.type || 'jet'}
          </span>
          <div className="specs">
            <span className="spec">
              <span className="spec-label">Capacity</span>
              <span className="spec-value">
                {aircraft?.capacity != null ? `${aircraft.capacity} pax` : '—'}
              </span>
            </span>
            <span className="spec">
              <span className="spec-label">Range</span>
              <span className="spec-value">
                {aircraft?.range != null ? `${aircraft.range.toLocaleString()} km` : '—'}
              </span>
            </span>
            <span className="spec">
              <span className="spec-label">Speed</span>
              <span className="spec-value">
                {aircraft?.cruiseSpeed != null ? `${aircraft.cruiseSpeed} km/h` : '—'}
              </span>
            </span>
          </div>
        </div>

      </div>

      {(flight.airlineIata || flight.airline) && (
        <OperatorSafetyBlock
          airlineIata={flight.airlineIata || (flight.airline?.length === 2 ? flight.airline : null)}
          airlineIcao={flight.airlineIcao || (flight.airline?.length === 3 ? flight.airline : null)}
          airlineName={flight.airline && flight.airline.length > 3 ? flight.airline : null}
        />
      )}

      {tripsEnabled && (
        <div className="flight-trip-actions">
          <AddToTripsButton flight={flight} />
        </div>
      )}

      {enrichedCardEnabled && enrichedId && (
        <EnrichedPanel
          flight={{
            id: enrichedId,
            airline: airlineCode,
            flightNumber: flightDigits,
            departure: flight.departure,
            arrival: flight.arrival,
            aircraft: {
              icaoType: aircraft?.icaoType
                       || amadeusToIcao(flight.aircraftCode || aircraft?.code)
                       || null,
              registration: aircraft?.registration || null,
            },
          }}
          showProTeaser={showProTeaser}
        />
      )}
    </div>
    </>
  );
}

export default FlightCard;

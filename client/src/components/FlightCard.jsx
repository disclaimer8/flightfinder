import { useState } from 'react';
import './FlightCard.css';
import BookingModal from './BookingModal';

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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
            {dateChanged && <sup className="day-offset">+1</sup>}
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

function buildKayakUrl(flight) {
  const dep = flight.departure?.code;
  const arr = flight.arrival?.code;
  const date = flight.departureTime ? flight.departureTime.slice(0, 10) : '';
  if (!dep || !arr || !date) return null;
  if (flight.isRoundTrip && flight.returnItinerary?.departureTime) {
    const ret = flight.returnItinerary.departureTime.slice(0, 10);
    return `https://www.kayak.com/flights/${dep}-${arr}/${date}/${ret}/1adults`;
  }
  return `https://www.kayak.com/flights/${dep}-${arr}/${date}/1adults`;
}

function FlightCard({ flight }) {
  const { aircraft } = flight;
  const [showBooking, setShowBooking] = useState(false);

  const isDuffel = flight.source === 'duffel';
  const kayakUrl = buildKayakUrl(flight);

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

        {isDuffel ? (
          <button className="btn-book" onClick={() => setShowBooking(true)}>Book now</button>
        ) : kayakUrl ? (
          <a
            className="btn-book btn-book-external"
            href={kayakUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Opens Kayak.com in a new tab"
            aria-label={`Book ${flight.airline} flight on Kayak.com (opens new tab)`}
          >
            Book via Kayak
            <svg aria-hidden="true" focusable="false" className="btn-external-icon" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        ) : (
          <button className="btn-book" disabled>Book</button>
        )}
      </div>
    </div>

    {showBooking && (
      <BookingModal flight={flight} onClose={() => setShowBooking(false)} />
    )}
    </>
  );
}

export default FlightCard;

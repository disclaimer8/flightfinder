// FlightCard — search result row.
function FlightCard({ flight, onBook }) {
  return (
    <div className="fc">
      <div className="fc__route">
        <div>
          <div className="fc__iata">{flight.from}</div>
          <div className="fc__times">{flight.depart}</div>
        </div>
        <div className="fc__arrow">→</div>
        <div>
          <div className="fc__iata">{flight.to}</div>
          <div className="fc__times">{flight.arrive}</div>
        </div>
      </div>
      <div className="fc__meta">
        <div className="fc__airline">{flight.airline}</div>
        <div className="fc__details">
          <span style={{ fontFamily: 'var(--font-mono)' }}>{flight.duration}</span>
          <span>·</span>
          {flight.stops === 0
            ? <span className="badge badge--direct">Direct</span>
            : <span className="badge badge--stops">{flight.stops} stop</span>}
          <span>·</span>
          <span>{flight.aircraft}</span>
          {flight.aircraftType === 'wide-body' && <span className="badge badge--widebody">Wide‑body</span>}
          {flight.aircraftType === 'jet'       && <span className="badge badge--jet">Jet</span>}
        </div>
      </div>
      <div className="fc__price-col">
        <div className="fc__price">${flight.price}</div>
        <div className="fc__note">per person</div>
        <button className="btn btn--navy" onClick={() => onBook(flight)}>Book ↗</button>
      </div>
    </div>
  );
}
window.FlightCard = FlightCard;

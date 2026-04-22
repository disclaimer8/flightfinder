import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTrips, deleteTrip, fetchTripStatus } from '../hooks/useTrips';
import './MyTrips.css';

export default function MyTrips() {
  const { getToken } = useAuth();
  const { trips, error, refresh } = useTrips();
  const [statusById, setStatusById] = useState({});

  if (error) return <div className="mytrips-error">{error}</div>;
  if (!trips) return <div className="mytrips-loading">Loading…</div>;
  if (!trips.length) return (
    <div className="mytrips-empty">
      <h2>No trips yet</h2>
      <p>Find a flight and click <strong>+ Add to My Trips</strong> to track it here.</p>
    </div>
  );

  async function loadStatus(id) {
    const j = await fetchTripStatus(id, getToken?.());
    if (j.success) setStatusById((s) => ({ ...s, [id]: j.data }));
  }

  async function onDelete(id) {
    await deleteTrip(id, getToken?.());
    refresh();
  }

  return (
    <div className="mytrips">
      <h1>My Trips</h1>
      <ul className="trip-list">
        {trips.map((t) => (
          <li key={t.id} className="trip-card">
            <div className="trip-head">
              <div className="trip-title">
                {t.airline_iata}{t.flight_number} · {t.dep_iata} → {t.arr_iata}
              </div>
              <div className="trip-when">{new Date(t.scheduled_dep).toLocaleString()}</div>
            </div>
            <div className="trip-actions">
              <button onClick={() => loadStatus(t.id)}>Refresh status</button>
              <button onClick={() => onDelete(t.id)}>Remove</button>
            </div>
            {statusById[t.id] && <TripStatus status={statusById[t.id]} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TripStatus({ status }) {
  const { live, prediction, inbound } = status;
  return (
    <div className="trip-status">
      {live && (
        <div className="trip-live">
          <span>Gate: {live.originGate || '—'} · Terminal: {live.originTerminal || '—'}</span>
          {live.destGate && <span> · Arrival gate: {live.destGate} · T{live.destTerminal}</span>}
          {live.baggage && <span> · Baggage: {live.baggage}</span>}
        </div>
      )}
      {prediction && prediction.confidence !== 'low' && (
        <div className="trip-pred">
          Predicted delay: median {prediction.median} min (p75 {prediction.p75}) · {prediction.sample} samples · {prediction.confidence} confidence
        </div>
      )}
      {inbound?.position && (
        <div className="trip-inbound">
          Inbound: {inbound.callsign} @ {inbound.altitude} ft — {inbound.position.lat.toFixed(2)},{inbound.position.lon.toFixed(2)}
        </div>
      )}
    </div>
  );
}

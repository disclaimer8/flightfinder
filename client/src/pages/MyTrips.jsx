import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTrips, deleteTrip, fetchTripStatus } from '../hooks/useTrips';
import './MyTrips.css';

function formatDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function delayClass(status) {
  const m = status?.prediction?.median;
  if (m == null) return '';
  if (m >= 60) return 'trip-card--delay-crit';
  if (m >= 30) return 'trip-card--delay-warn';
  return '';
}

export default function MyTrips() {
  const { getToken, user, loading: authLoading } = useAuth();
  const { trips, error, refresh } = useTrips();
  const [statusById, setStatusById] = useState({});

  if (authLoading) return <div className="mytrips-loading">Loading…</div>;
  if (!user) return (
    <div className="mytrips-empty">
      <h2>My Trips</h2>
      <p>Track upcoming flights with delay alerts and live status.</p>
      <p className="mytrips-empty__hint">My Trips is a Pro feature requiring sign-in.</p>
      <Link to="/" className="mytrips-empty__cta">Go to homepage</Link>
    </div>
  );
  if (error) return <div className="mytrips-error">{error}</div>;
  if (!trips) return <div className="mytrips-loading">Loading…</div>;
  if (!trips.length) return (
    <div className="mytrips-empty">
      <h2>No trips yet</h2>
      <p>Find a flight and click <strong>+ Add to My Trips</strong> to track it here.</p>
      <Link to="/" className="mytrips-empty__cta">Search flights</Link>
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
          <li
            key={t.id}
            className={`trip-card ${delayClass(statusById[t.id])}`}
          >
            <div className="trip-head">
              <div>
                <span className="trip-flightnum">{t.airline_iata}{t.flight_number}</span>
                <span className="trip-route">
                  {' · '}
                  <span>{t.dep_iata}</span>
                  <span className="trip-route__arrow">→</span>
                  <span>{t.arr_iata}</span>
                </span>
              </div>
              <span className="trip-when">{formatDate(t.scheduled_dep)}</span>
            </div>
            <div className="trip-actions">
              <button onClick={() => loadStatus(t.id)}>Refresh status</button>
              <button className="trip-actions__delete" onClick={() => onDelete(t.id)}>Remove</button>
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

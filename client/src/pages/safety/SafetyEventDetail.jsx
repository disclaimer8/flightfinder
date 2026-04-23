import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchEvent } from './safetyApi';
import './SafetyEventDetail.css';

export default function SafetyEventDetail() {
  const { id } = useParams();
  const [event, setEvent] = useState(undefined); // undefined = loading; null = 404
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setError(null);
    fetchEvent(id)
      .then(e => { if (active) setEvent(e); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [id]);

  if (error) return <main className="safety-detail"><p>Error: {error}</p></main>;
  if (event === undefined) return <main className="safety-detail"><p>Loading…</p></main>;
  if (event === null) {
    return (
      <main className="safety-detail">
        <h1>Event not found</h1>
        <Link to="/safety/feed">← Back to feed</Link>
      </main>
    );
  }

  return (
    <main className="safety-detail">
      <Link to="/safety/feed" className="safety-detail__back">← Back to feed</Link>

      <h1 className="safety-detail__title">
        <span className={`safety-badge safety-badge--${event.severity}`}>{event.severityLabel}</span>
        {event.cicttLabel}
      </h1>

      <dl className="safety-detail__grid">
        <div><dt>Date</dt><dd>{new Date(event.occurredAt).toUTCString()}</dd></div>
        <div><dt>Operator</dt><dd>{event.operator.name || event.operator.icao || '—'}</dd></div>
        <div><dt>Registration</dt><dd>{event.aircraft.registration || '—'}</dd></div>
        <div><dt>Phase</dt><dd>{event.phaseOfFlight}</dd></div>
        <div><dt>Route</dt><dd>{event.route.dep || '—'} → {event.route.arr || '—'}</dd></div>
        <div><dt>Fatalities</dt><dd>{event.fatalities}</dd></div>
        <div><dt>Injuries</dt><dd>{event.injuries}</dd></div>
        <div><dt>Hull loss</dt><dd>{event.hullLoss ? 'Yes' : 'No'}</dd></div>
        <div><dt>Country</dt><dd>{event.location.country || '—'}</dd></div>
      </dl>

      {event.narrative && (
        <section className="safety-detail__narrative">
          <h2>Probable cause</h2>
          <p>{event.narrative}</p>
        </section>
      )}

      <p className="safety-detail__source">
        Source:{' '}
        <a href={event.reportUrl} rel="nofollow noopener noreferrer">{event.sourceEventId} (NTSB)</a>
      </p>
    </main>
  );
}

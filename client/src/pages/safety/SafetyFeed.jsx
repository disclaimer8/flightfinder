import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchEvents } from './safetyApi';
import './SafetyFeed.css';

const SEVERITIES = [
  { code: null,                label: 'All' },
  { code: 'fatal',             label: 'Fatal' },
  { code: 'hull_loss',         label: 'Hull loss' },
  { code: 'serious_incident',  label: 'Serious' },
  { code: 'incident',          label: 'Incident' },
  { code: 'minor',             label: 'Minor' },
];

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export default function SafetyFeed() {
  const [events, setEvents]   = useState(null);
  const [error, setError]     = useState(null);
  const [severity, setSeverity] = useState(null);

  useEffect(() => {
    let active = true;
    setError(null);
    setEvents(null);
    fetchEvents({ limit: 100, severity })
      .then(b => { if (active) setEvents(b.data); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [severity]);

  return (
    <main className="safety-feed">
      <header className="safety-feed__header">
        <h1>Aviation safety feed</h1>
        <p>
          Recent aviation accidents and incidents from official NTSB records.
          Source: <a href="https://data.ntsb.gov/" rel="nofollow noopener noreferrer">NTSB CAROL</a>.
        </p>
      </header>

      <nav className="safety-feed__filters" aria-label="Severity filter">
        {SEVERITIES.map(s => (
          <button
            key={s.code || 'all'}
            className={`safety-pill${severity === s.code ? ' safety-pill--active' : ''}`}
            onClick={() => setSeverity(s.code)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {error && <p className="safety-feed__error">Failed to load: {error}</p>}
      {!events && !error && <p className="safety-feed__loading">Loading…</p>}

      {events && events.length === 0 && (
        <p className="safety-feed__empty">No events match this filter.</p>
      )}

      {events && events.length > 0 && (
        <ul className="safety-feed__list">
          {events.map(e => (
            <li key={e.id} className={`safety-card safety-card--${e.severity}`}>
              <Link to={`/safety/events/${e.id}`} className="safety-card__link">
                <div className="safety-card__head">
                  <span className={`safety-badge safety-badge--${e.severity}`}>{e.severityLabel}</span>
                  <span className="safety-card__date">{formatDate(e.occurredAt)}</span>
                </div>
                <h2 className="safety-card__title">
                  {e.cicttLabel}
                  {e.route.dep && e.route.arr && (
                    <span className="safety-card__route">&nbsp;&nbsp;{e.route.dep} &rarr; {e.route.arr}</span>
                  )}
                </h2>
                <p className="safety-card__meta">
                  {e.operator.name || e.operator.icao || e.operator.iata || 'Operator unknown'}
                  {e.aircraft.registration ? `  ${e.aircraft.registration}` : ''}
                  {e.fatalities > 0 ? `  ${e.fatalities} fatalities` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

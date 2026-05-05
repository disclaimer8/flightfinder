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

const SEVERITY_DOT_CLASS = {
  fatal:            'sf-dot--fatal',
  hull_loss:        'sf-dot--hull',
  serious_incident: 'sf-dot--hull',
  incident:         'sf-dot--incident',
  minor:            'sf-dot--incident',
};

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dash(v) {
  return v == null || v === '' ? '—' : v;
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
        <table className="safety-feed__table">
          <thead>
            <tr>
              <th className="sf-col-date">Date</th>
              <th className="sf-col-severity">Severity</th>
              <th className="sf-col-aircraft">Aircraft</th>
              <th className="sf-col-route">Route / Location</th>
            </tr>
          </thead>
          <tbody>
            {events.map(e => (
              <tr
                key={e.id}
                className={`safety-feed__row safety-feed__row--${e.severity}`}
              >
                <td className="sf-col-date">{formatDate(e.occurredAt)}</td>
                <td className="sf-col-severity">
                  <span className={`safety-feed__dot ${SEVERITY_DOT_CLASS[e.severity] || 'sf-dot--incident'}`} aria-hidden="true" />
                  <span className="safety-feed__sev-label">{e.severityLabel}</span>
                </td>
                <td className="sf-col-aircraft">
                  {dash(e.aircraft.icaoType)}
                  {e.aircraft.registration && (
                    <span className="safety-feed__reg"> {e.aircraft.registration}</span>
                  )}
                </td>
                <td className="sf-col-route">
                  <span>{dash(e.route.dep)}</span>
                  <span className="safety-feed__arrow"> → </span>
                  <span>{e.route.arr || e.location.country || '—'}</span>
                  <Link
                    to={`/safety/events/${e.id}`}
                    className="safety-feed__row-link"
                    aria-label={`View event ${e.id}`}
                  >
                    <span className="visually-hidden">View event</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchEvents } from './safetyApi';
import EmptyState from '../../components/EmptyState';
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

// Render the Aircraft cell. NTSB rarely publishes an ICAO type code for
// general-aviation rows but usually has a tail/registration. Avoid
// "— N6067J" by collapsing the dash when the tail alone is meaningful.
function AircraftCell({ aircraft }) {
  const type = aircraft.icaoType;
  const reg  = aircraft.registration;
  if (!type && !reg) return <>—</>;
  if (!type)         return <span className="safety-feed__reg">{reg}</span>;
  if (!reg)          return <>{type}</>;
  return <>{type}<span className="safety-feed__reg"> {reg}</span></>;
}

// Render the Route/Location cell. Most NTSB rows have no dep/arr — just a
// country. Showing "— → USA" everywhere is noise. Render the arrow only
// when both endpoints are present; otherwise show whatever's available.
function RouteCell({ route, location }) {
  const dep = route.dep || '';
  const arr = route.arr || '';
  const country = location.country || '';
  if (dep && arr) {
    return <>{dep}<span className="safety-feed__arrow"> → </span>{arr}</>;
  }
  if (dep)         return <>{dep}</>;
  if (arr)         return <>{arr}</>;
  if (country)     return <>{country}</>;
  return <>—</>;
}

const PAGE_SIZE = 100;

export default function SafetyFeed() {
  const [events, setEvents]   = useState(null);
  const [error, setError]     = useState(null);
  const [severity, setSeverity] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    setEvents(null);
    setExhausted(false);
    fetchEvents({ limit: PAGE_SIZE, severity })
      .then(b => {
        if (!active) return;
        setEvents(b.data);
        if (b.data.length < PAGE_SIZE) setExhausted(true);
      })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [severity]);

  const loadMore = () => {
    if (loadingMore || exhausted || !events) return;
    setLoadingMore(true);
    fetchEvents({ limit: PAGE_SIZE, offset: events.length, severity })
      .then(b => {
        setEvents(prev => [...(prev || []), ...b.data]);
        if (b.data.length < PAGE_SIZE) setExhausted(true);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoadingMore(false));
  };

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
        <EmptyState>No events match this filter.</EmptyState>
      )}

      {events && events.length > 0 && (<>
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
                  <AircraftCell aircraft={e.aircraft} />
                </td>
                <td className="sf-col-route">
                  <RouteCell route={e.route} location={e.location} />
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
        {!exhausted && (
          <div className="safety-feed__more">
            <button
              className="safety-pill"
              onClick={loadMore}
              disabled={loadingMore}
              aria-label="Load more events"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </>)}

      <p className="methodology-note">
        Methodology last reviewed 2026-05-06. See <Link to="/about">/about</Link> for data sources and editorial policy.
      </p>
    </main>
  );
}

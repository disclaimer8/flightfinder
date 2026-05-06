import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import './AircraftRouteLanding.css';

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export default function AircraftRouteLanding() {
  const { pair, aircraftSlug } = useParams();
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  const [siblings, setSiblings] = useState([]);

  useEffect(() => {
    let active = true;
    setError(null);
    fetch(`${API_BASE}/api/routes/${pair}/aircraft/${aircraftSlug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (active) setData(j.data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [pair, aircraftSlug]);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/routes/${pair}/aircraft-list`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => {
        if (active) {
          setSiblings(
            (j.data || []).filter((s) => s.slug !== aircraftSlug).slice(0, 5)
          );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pair, aircraftSlug]);

  if (error) {
    return (
      <main className="ar-landing">
        <h1>Not found</h1>
        <p>This aircraft + route combination is not currently indexed.</p>
        <p>
          <Link to="/">← Home</Link>
          {' · '}
          <Link to={`/routes/${pair}`}>View {pair ? pair.toUpperCase() : ''} route page</Link>
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="ar-landing">
        <p className="ar-landing__loading">Loading…</p>
      </main>
    );
  }

  const { operators = [], fromIata, toIata } = data;

  return (
    <main className="ar-landing">
      <nav className="ar-landing__breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        {' › '}
        <Link to={`/routes/${pair}`}>
          {fromIata} → {toIata}
        </Link>
        {' › '}
        <span>{aircraftSlug}</span>
      </nav>

      <p className="ar-landing__intro">
        Flights operated by this aircraft model on this route, compiled from
        open ADS-B observed-flights data over the last 90 days.
      </p>

      {operators.length > 0 ? (
        <section className="ar-landing__operators">
          <h2 className="eyebrow eyebrow--strong">Operators on this route</h2>
          <ul className="ar-landing__operator-list">
            {operators.map((op) => (
              <li key={op.airline_iata || op.airline_name}>
                <strong>{op.airline_name}</strong>
                <span>
                  {op.models.length} model{op.models.length === 1 ? '' : 's'} (
                  {op.models.join(', ')}) · last seen {fmtDate(op.last_seen_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="ar-landing__empty">
          No observed flights on this aircraft+route in the last 90 days.
        </p>
      )}

      <section className="ar-landing__cross">
        <h2 className="eyebrow eyebrow--strong">
          Other aircraft on the {fromIata} → {toIata} route
        </h2>
        {siblings.length > 0 ? (
          <ul className="ar-landing__sibling-list">
            {siblings.map((s) => (
              <li key={s.slug}>
                <Link to={`/routes/${pair}/${s.slug}`}>{s.label}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>Currently only this aircraft is observed on this route.</p>
        )}
        <p>
          <Link to={`/routes/${pair}`}>
            View all flights on the {fromIata} → {toIata} route →
          </Link>
        </p>
        <p>
          <Link to={`/aircraft/${aircraftSlug}`}>
            View all routes flown by this aircraft type →
          </Link>
        </p>
      </section>
    </main>
  );
}

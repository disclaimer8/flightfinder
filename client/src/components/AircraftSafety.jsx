import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import './AircraftPillar.css';

const API = (import.meta.env.VITE_API_BASE || '');

function fmtDate(ms) { return new Date(ms).toISOString().slice(0, 10); }

export default function AircraftSafety() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [label, setLabel] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/aircraft/${slug}/safety`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (active) { setData(j.data); setLabel(j.label || slug); } })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [slug]);

  if (error) return <main className="ac-pillar"><h1>Not found</h1></main>;
  if (!data) return <main className="ac-pillar"><p>Loading&#8230;</p></main>;

  const fatal = data.filter((e) => e.severity === 'fatal').length;
  const hullLoss = data.filter((e) => e.hull_loss === 1).length;
  const incidents = data.length - fatal - hullLoss;
  const displayLabel = label || slug;

  return (
    <main className="ac-pillar">
      <nav className="ac-pillar__breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>{' › '}
        <Link to="/by-aircraft">By aircraft</Link>{' › '}
        <Link to={`/aircraft/${slug}`}>{displayLabel}</Link>{' › '}
        <span>Safety</span>
      </nav>
      <p className="ac-pillar__intro">
        Public records show {data.length} aviation event{data.length === 1 ? '' : 's'}{' '}
        involving this aircraft type: {fatal} fatal,{' '}
        {hullLoss} hull loss{hullLoss === 1 ? '' : 'es'}, and {incidents} incident{incidents === 1 ? '' : 's'}.
        Aggregated from NTSB CAROL, Aviation Safety Network, B3A, and Wikidata.
      </p>
      {data.length > 0 ? (
        <section className="ac-pillar__events">
          <h2 className="eyebrow eyebrow--strong">Events ({data.length})</h2>
          <ul className="ac-pillar__events-list">
            {data.map((ev) => (
              <li key={ev.id}>
                <Link to={`/safety/events/${ev.id}`}>
                  <strong>
                    <span className={`safety-badge safety-badge--${ev.severity}`}>
                      {ev.severity}
                    </span>
                    {' '}{fmtDate(ev.occurred_at)} &middot; {ev.operator_name || ev.operator_icao || 'Unknown'}
                  </strong>
                </Link>
                <div className="ac-pillar__route-meta">
                  {ev.aircraft_icao_type || ev.aircraft_model_text || 'Unknown type'}
                  {' '}&middot;{' '}
                  {ev.location_text || ev.location_country || 'unknown location'}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="ac-pillar__empty">No safety events recorded for this aircraft type.</p>
      )}
      <section className="ac-pillar__cross">
        <h2 className="eyebrow eyebrow--strong">Explore further</h2>
        <ul>
          <li><Link to={`/aircraft/${slug}`}>&#8592; Back to {displayLabel} overview</Link></li>
          <li><Link to={`/aircraft/${slug}/airlines`}>Airlines that operate this aircraft &#8594;</Link></li>
          <li><Link to={`/aircraft/${slug}/routes`}>Routes flown by this aircraft &#8594;</Link></li>
          <li><Link to={`/aircraft/${slug}/specs`}>Specifications &#8594;</Link></li>
          <li><Link to="/safety/global">Global aviation safety database &#8594;</Link></li>
        </ul>
      </section>
    </main>
  );
}

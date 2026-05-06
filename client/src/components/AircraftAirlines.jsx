import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import './AircraftPillar.css';

const API = (import.meta.env.VITE_API_BASE || '');

export default function AircraftAirlines() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/aircraft/${slug}/airlines`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (active) setData(j.data); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [slug]);

  if (error) return <main className="ac-pillar"><h1>Not found</h1></main>;
  if (!data) return <main className="ac-pillar"><p>Loading&#8230;</p></main>;

  const routeTotal = data.reduce((sum, o) => sum + o.route_count, 0);

  return (
    <main className="ac-pillar">
      <nav className="ac-pillar__breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>{' › '}
        <Link to="/by-aircraft">By aircraft</Link>{' › '}
        <Link to={`/aircraft/${slug}`}>{slug}</Link>{' › '}
        <span>Airlines</span>
      </nav>
      <p className="ac-pillar__intro">
        {data.length}{' '}
        {data.length === 1 ? 'airline has' : 'airlines have'} operated this aircraft
        type on {routeTotal} observed route{routeTotal === 1 ? '' : 's'} in the last 90
        days. Data sourced from open ADS-B observations refreshed nightly.
      </p>
      {data.length > 0 ? (
        <section className="ac-pillar__operators">
          <h2 className="eyebrow eyebrow--strong">Operators ({data.length})</h2>
          <ul className="ac-pillar__operator-list">
            {data.map((o) => (
              <li key={o.airline_iata}>
                <strong>{o.airline_name}</strong>
                <div className="ac-pillar__operator-meta">
                  {o.airline_iata} &middot; {o.route_count} route{o.route_count === 1 ? '' : 's'} &middot;{' '}
                  models: {o.models.join(', ')}
                </div>
                {o.sample_routes.length > 0 && (
                  <div className="ac-pillar__sample-routes">
                    Sample routes: {o.sample_routes.join(' · ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="ac-pillar__empty">No operators observed in the last 90 days.</p>
      )}
      <section className="ac-pillar__cross">
        <h2 className="eyebrow eyebrow--strong">Explore further</h2>
        <ul>
          <li><Link to={`/aircraft/${slug}`}>&#8592; Back to {slug} overview</Link></li>
          <li><Link to={`/aircraft/${slug}/routes`}>Routes flown by this aircraft &#8594;</Link></li>
          <li><Link to={`/aircraft/${slug}/safety`}>Safety record &#8594;</Link></li>
          <li><Link to={`/aircraft/${slug}/specs`}>Specifications &#8594;</Link></li>
        </ul>
      </section>
    </main>
  );
}

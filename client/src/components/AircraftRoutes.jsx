import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import './AircraftPillar.css';

const API = (import.meta.env.VITE_API_BASE || '');

export default function AircraftRoutes() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/aircraft/${slug}/routes`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (active) setData(j.data); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [slug]);

  if (error) return <main className="ac-pillar"><h1>Not found</h1></main>;
  if (!data) return <main className="ac-pillar"><p>Loading&#8230;</p></main>;

  const operatorTotal = new Set(data.flatMap((r) => r.operators)).size;

  return (
    <main className="ac-pillar">
      <nav className="ac-pillar__breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>{' › '}
        <Link to="/by-aircraft">By aircraft</Link>{' › '}
        <Link to={`/aircraft/${slug}`}>{slug}</Link>{' › '}
        <span>Routes</span>
      </nav>
      <p className="ac-pillar__intro">
        This aircraft type has been observed on {data.length}{' '}
        {data.length === 1 ? 'route' : 'routes'} by {operatorTotal}{' '}
        {operatorTotal === 1 ? 'operator' : 'operators'} in the last 90 days.
        Each route below deep-links to its dedicated page combining city pair
        and aircraft data.
      </p>
      {data.length > 0 ? (
        <section className="ac-pillar__routes">
          <h2 className="eyebrow eyebrow--strong">Routes ({data.length})</h2>
          <ul className="ac-pillar__route-list">
            {data.map((r) => {
              const pair = `${r.dep_iata.toLowerCase()}-${r.arr_iata.toLowerCase()}`;
              return (
                <li key={pair}>
                  <Link to={`/routes/${pair}/${slug}`}>
                    {r.dep_iata} &#8594; {r.arr_iata}
                  </Link>
                  <div className="ac-pillar__route-meta">
                    {r.operator_count} operator{r.operator_count === 1 ? '' : 's'} &middot;{' '}
                    {r.models.length} model variant{r.models.length === 1 ? '' : 's'} ({r.models.join(', ')})
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="ac-pillar__empty">No routes observed in the last 90 days.</p>
      )}
      <section className="ac-pillar__cross">
        <h2 className="eyebrow eyebrow--strong">Explore further</h2>
        <ul>
          <li><Link to={`/aircraft/${slug}`}>&#8592; Back to {slug} overview</Link></li>
          <li><Link to={`/aircraft/${slug}/airlines`}>Airlines that operate this aircraft &#8594;</Link></li>
          <li><Link to={`/aircraft/${slug}/safety`}>Safety record &#8594;</Link></li>
          <li><Link to={`/aircraft/${slug}/specs`}>Specifications &#8594;</Link></li>
        </ul>
      </section>
    </main>
  );
}

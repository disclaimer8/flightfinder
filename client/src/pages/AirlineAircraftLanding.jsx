import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import styles from './AirlineAircraftLanding.module.css';

export default function AirlineAircraftLanding() {
  const { iata, icao } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    setData(null);
    fetch(`${API_BASE}/api/airline/${iata}/aircraft/${icao}/routes`)
      .then(r => r.ok ? r.json() : Promise.reject({ status: r.status }))
      .then(b => { if (active) setData(b); })
      .catch(err => { if (active) setError(err); });
    return () => { active = false; };
  }, [iata, icao]);

  if (error) return (
    <main className={styles.page}>
      {error.status === 404
        ? <>
            <h1>No routes found</h1>
            <p>This airline + aircraft combination has fewer than 5 routes observed in the last 90 days. <Link to="/by-aircraft">Browse aircraft</Link>.</p>
          </>
        : <>
            <h1>Failed to load</h1>
            <p>Something went wrong — please try again.</p>
          </>
      }
    </main>
  );
  if (!data) return <main className={styles.page}><p className={styles.loading}>Loading…</p></main>;

  // Routes are nested: r.dep.iata, r.dep.city, r.arr.iata, r.arr.city
  const routes = data.routes;
  const visibleRoutes = showAll ? routes : routes.slice(0, 30);

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.h1}>{data.airline.name} routes on the {data.aircraft.name}</h1>
        <p className={styles.lede}>In the last 90 days, {data.airline.name} operated the {data.aircraft.name} on {data.summary.n_pairs} distinct city pairs across {data.summary.n_airports} airports.</p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.h2}>Routes flown</h2>
        <div className={styles.tableWrap}>
          <table className={styles.routesTable}>
            <thead>
              <tr>
                <th scope="col">Departure</th>
                <th scope="col">Arrival</th>
                <th scope="col">Distance</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {visibleRoutes.map(r => (
                <tr key={`${r.dep.iata}-${r.arr.iata}`}>
                  <td><Link to={`/search?from=${r.dep.iata}&to=${r.arr.iata}`}>{r.dep.city || r.dep.iata}</Link></td>
                  <td>{r.arr.city || r.arr.iata}</td>
                  <td className={styles.mono}>{Math.round(r.distance_km).toLocaleString()} km</td>
                  <td className={styles.mono}>{r.last_seen_at ? new Date(r.last_seen_at).toISOString().slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {routes.length > 30 && !showAll && (
          <button className={styles.showAll} onClick={() => setShowAll(true)}>
            Show all {routes.length} routes
          </button>
        )}
      </section>

      <section className={styles.cards}>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Airline</h3>
          <p className={styles.cardName}>{data.airline.name}</p>
          {data.airline.country && <p className={styles.cardMeta}>{data.airline.country}</p>}
          <p className={styles.cardLink}><Link to={`/airline/${iata.toLowerCase()}`}>All {data.airline.name} routes →</Link></p>
        </div>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Aircraft</h3>
          <p className={styles.cardName}>{data.aircraft.name}</p>
          {data.aircraft.category && <p className={styles.cardMeta}>{data.aircraft.category}</p>}
          {data.aircraft.slug && <p className={styles.cardLink}><Link to={`/aircraft/${data.aircraft.slug}`}>All {data.aircraft.name} routes →</Link></p>}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Frequently asked questions</h2>
        <details className={styles.details}>
          <summary>How many routes does {data.airline.name} fly on the {data.aircraft.name}?</summary>
          <p>{routes.length} distinct routes in the last 90 days.</p>
        </details>
        {data.summary.longest && (
          <details className={styles.details}>
            <summary>What is the longest route?</summary>
            <p>{data.summary.longest.dep} → {data.summary.longest.arr}, {Math.round(data.summary.longest.distance_km).toLocaleString()} km.</p>
          </details>
        )}
        {data.summary.shortest && (
          <details className={styles.details}>
            <summary>What is the shortest route?</summary>
            <p>{data.summary.shortest.dep} → {data.summary.shortest.arr}, {Math.round(data.summary.shortest.distance_km).toLocaleString()} km.</p>
          </details>
        )}
        <details className={styles.details}>
          <summary>Which airports does {data.airline.name} use for the {data.aircraft.name}?</summary>
          <p>{topAirports(routes, 5).join(', ')}</p>
        </details>
      </section>
    </main>
  );
}

function topAirports(routes, n) {
  const freq = new Map();
  for (const r of routes) {
    freq.set(r.dep.iata, (freq.get(r.dep.iata) || 0) + 1);
    freq.set(r.arr.iata, (freq.get(r.arr.iata) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([iata]) => iata);
}

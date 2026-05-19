import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import styles from './AirlineLanding.module.css';

export default function AirlineLanding() {
  const { iata } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setError(null);
    setData(null);
    fetch(`${API_BASE}/api/airline/${iata}`)
      .then(r => r.ok ? r.json() : Promise.reject({ status: r.status }))
      .then(b => { if (active) setData(b); })
      .catch(err => { if (active) setError(err); });
    return () => { active = false; };
  }, [iata]);

  if (error) {
    return (
      <main className={styles.page}>
        <div className={styles.error}>
          {error.status === 404 ? (
            <>
              <h1>No data yet</h1>
              <p>We're still gathering routes for this carrier. <Link to="/by-aircraft">Browse by aircraft</Link>.</p>
            </>
          ) : (
            <>
              <h1>Failed to load</h1>
              <p>Something went wrong — please try again.</p>
            </>
          )}
        </div>
      </main>
    );
  }
  if (!data) return <main className={styles.page}><p className={styles.loading}>Loading…</p></main>;

  const { airline, jonty, observed } = data;
  const iataLower = (airline.iata || '').toLowerCase();
  const safetyOp = encodeURIComponent(airline.icao || airline.iata || '');

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.h1}>{airline.name} — destinations and fleet</h1>
        {jonty && (
          <p className={styles.lede}>
            {airline.name} operates {jonty.totalRoutes} non-stop routes across {jonty.totalCountries} countries
            {jonty.hubCount > 0 ? `, with ${jonty.hubCount} hub airport${jonty.hubCount === 1 ? '' : 's'}` : ''}.
          </p>
        )}
      </header>

      {jonty && jonty.origins.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.h2}>Where {airline.name} flies from</h2>
          <ul className={styles.originsList}>
            {jonty.origins.map(o => (
              <li key={o.iata}>
                <Link to={`/airline/${iataLower}/from/${o.iata}`}>
                  {o.city || o.iata} ({o.iata}) — {o.routeCount} route{o.routeCount === 1 ? '' : 's'}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {observed.topAircraft.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.h2}>Top aircraft</h2>
          <ul className={styles.list}>
            {observed.topAircraft.map(ac => (
              <li key={ac.icao}>
                {ac.hasMatrix
                  ? <Link to={`/airline/${iataLower}/aircraft/${ac.icao.toLowerCase()}`}>{ac.name}</Link>
                  : ac.name}
                {' — '}
                <span className={styles.mono}>{ac.nPairs}</span> route pair{ac.nPairs === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </section>
      )}

      {observed.hubs.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.h2}>Hub airports</h2>
          <ul className={styles.list}>
            {observed.hubs.map(h => (
              <li key={h.iata}>
                <span className={styles.mono}>{h.iata}</span> · {h.city}{h.country ? `, ${h.country}` : ''} · <span className={styles.mono}>{h.pairCount}</span> route{h.pairCount === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </section>
      )}

      {observed.topDests.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.h2}>Top destinations</h2>
          <ul className={styles.list}>
            {observed.topDests.map(d => (
              <li key={d.iata}>
                <span className={styles.mono}>{d.iata}</span> · {d.city}{d.country ? `, ${d.country}` : ''} · <span className={styles.mono}>{d.pairCount}</span> route{d.pairCount === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.h2}>Safety record</h2>
        <p>Recent accident and incident reports involving {airline.name} aircraft.</p>
        <p><Link to={`/safety/global?op=${safetyOp}`}>View safety database →</Link></p>
      </section>
    </main>
  );
}

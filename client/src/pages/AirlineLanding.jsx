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

  const { airline } = data;
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.h1}>{airline.name} — destinations and fleet</h1>
      </header>
    </main>
  );
}

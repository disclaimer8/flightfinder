import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import styles from './AircraftTopRoutesPrices.module.css';

const fmt = (n) => `€${Math.round(n)}`;

export default function AircraftTopRoutesPrices({ icao, familyLabel }) {
  const [data, setData] = useState(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setErrored(false);
    fetch(`${API_BASE}/api/aircraft/${icao}/prices`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((b) => { if (active) setData(b); })
      .catch(() => { if (active) setErrored(true); });
    return () => { active = false; };
  }, [icao]);

  if (errored) return null;
  if (!data) return null;
  if (!Array.isArray(data.routes) || data.routes.length < 3) return null;

  return (
    <section className={styles.section} data-widget="aircraft-top-routes-prices">
      <h2 className={styles.h2}>
        Where the {familyLabel || icao} flies — and what it costs
      </h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Median fare</th>
            <th scope="col" className={styles.colSamples}>Sample size</th>
          </tr>
        </thead>
        <tbody>
          {data.routes.map((r) => {
            const dep = r.dep_iata.toLowerCase();
            const arr = r.arr_iata.toLowerCase();
            return (
              <tr key={`${dep}-${arr}`}>
                <td>
                  <Link to={`/routes/${dep}-${arr}`}>
                    {r.dep_city || r.dep_iata} → {r.arr_city || r.arr_iata}
                  </Link>
                </td>
                <td className={styles.mono}>{fmt(r.median_eur)}</td>
                <td className={`${styles.mono} ${styles.colSamples}`}>{r.n_quotes} quotes</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.foot}>Top routes by sample size from the last ~30 days.</p>
    </section>
  );
}

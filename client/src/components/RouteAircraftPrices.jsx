import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import IncidentCountBadge from './IncidentCountBadge';
import styles from './RouteAircraftPrices.module.css';

function gflightsUrl(pair) {
  const [dep, arr] = String(pair).toUpperCase().split('-');
  return `https://www.google.com/travel/flights?q=Flights%20to%20${arr}%20from%20${dep}%20oneway`;
}

const fmt = (n) => `€${Math.round(n)}`;

export default function RouteAircraftPrices({ pair }) {
  const [data, setData] = useState(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setErrored(false);
    fetch(`${API_BASE}/api/routes/${pair}/prices`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((b) => { if (active) setData(b); })
      .catch(() => { if (active) setErrored(true); });
    return () => { active = false; };
  }, [pair]);

  if (errored) return null;
  if (!data) return null;
  if (!data.prices || data.prices.length === 0) return null;

  const totalQuotes = data.prices.reduce((s, r) => s + (r.n_quotes || 0), 0);

  return (
    <section className={styles.section} data-widget="route-aircraft-prices">
      <h2 className={styles.h2}>Typical fares by aircraft on this route</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Aircraft</th>
            <th scope="col">Median</th>
            <th scope="col" className={styles.colRange}>Range</th>
            <th scope="col" className={styles.colOperators}>Operators</th>
            <th scope="col">Safety</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {data.prices.map((row) => (
            <tr key={row.aircraft_icao}>
              <td><Link to={`/aircraft/${row.aircraft_slug}`}>{row.aircraft_name}</Link></td>
              <td className={styles.mono}>{fmt(row.median_eur)}</td>
              <td className={`${styles.mono} ${styles.colRange}`}>
                {fmt(row.min_eur)}–{fmt(row.max_eur)}
              </td>
              <td className={styles.colOperators}>{row.airlines_display}</td>
              <td>
                <IncidentCountBadge level={row.safety?.level} count={row.safety?.accident_count_5y ?? 0} />
              </td>
              <td>
                <a href={gflightsUrl(pair)} target="_blank" rel="noopener noreferrer">Check fares →</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.foot}>
        Based on {totalQuotes} recent fare observations · Same aircraft type from one airline shows identical stats (route-level data; aircraft attribution is statistical).
      </p>
    </section>
  );
}

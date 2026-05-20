import { useEffect, useMemo } from 'react';
import { topDestinations } from './computeMapData';
import styles from './Map.module.css';

/**
 * Slide-in right-side panel showing detail for a selected airport.
 *
 * Props:
 *   airport   {iata, name, city, country} | null   (null = panel closed)
 *   routes    Array<route>                          (filtered by current filters)
 *   airline   string | null                         (active /map airline filter, IATA)
 *   aircraft  string | null                         (active /map aircraft filter, ICAO)
 *   onClose   () => void
 */
export default function AirportPanel({ airport, routes, airline, aircraft, onClose }) {
  // Esc to close
  useEffect(() => {
    if (!airport) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [airport, onClose]);

  const stats = useMemo(() => {
    if (!airport) return null;
    const iata = airport.iata;
    const safeRoutes = Array.isArray(routes) ? routes : [];
    const myRoutes = safeRoutes.filter(r => r.dep?.iata === iata || r.arr?.iata === iata);
    const dests = new Set();
    let airlineTot = 0, aircraftTot = 0;
    for (const r of myRoutes) {
      const other = r.dep?.iata === iata ? r.arr?.iata : r.dep?.iata;
      if (other) dests.add(other);
      airlineTot  += r.airline_count  || 0;
      aircraftTot += r.aircraft_count || 0;
    }
    return {
      destinations: dests.size,
      airlines: airlineTot,
      aircraft: aircraftTot,
      top: topDestinations(safeRoutes, iata, 10),
    };
  }, [airport, routes]);

  if (!airport) return null;

  return (
    <aside className={`${styles.airportPanel} ${styles.airportPanelOpen}`} aria-label={`Airport detail for ${airport.iata}`}>
      <header className={styles.airportPanelHeader}>
        <div>
          <h2 className={styles.airportPanelTitle}>{airport.name || airport.iata}</h2>
          <p className={styles.airportPanelSubtitle}>
            {airport.iata}{airport.city ? ` · ${airport.city}` : ''}{airport.country ? `, ${airport.country}` : ''}
          </p>
        </div>
        <button
          type="button"
          className={styles.airportPanelClose}
          onClick={onClose}
          aria-label="Close airport detail"
        >×</button>
      </header>

      <div className={styles.airportPanelStats}>
        <div className={styles.statTile}>
          <span className={styles.statValue}>{stats.destinations}</span>
          <span className={styles.statLabel}>destinations</span>
        </div>
        <div className={styles.statTile}>
          <span className={styles.statValue}>{stats.airlines}</span>
          <span className={styles.statLabel}>airlines</span>
        </div>
        <div className={styles.statTile}>
          <span className={styles.statValue}>{stats.aircraft}</span>
          <span className={styles.statLabel}>aircraft</span>
        </div>
      </div>

      <div className={styles.airportPanelSection}>
        <h3 className={styles.airportPanelSectionTitle}>Top routes</h3>
        <ul className={styles.airportPanelDestList}>
          {stats.top.map(d => (
            <li key={d.iata}>
              <span className={styles.destIata}>{d.iata}</span>
              <span className={styles.destCount}>{d.count} route{d.count === 1 ? '' : 's'}</span>
            </li>
          ))}
          {stats.top.length === 0 && <li className={styles.destEmpty}>No destinations in current filter</li>}
        </ul>
      </div>

      <a className={styles.airportPanelCta} href={(() => {
        const params = new URLSearchParams({ from: airport.iata });
        if (aircraft) params.set('aircraft', aircraft);
        if (airline)  params.set('airlines', airline.toUpperCase());
        return `/search?${params.toString()}`;
      })()}>
        Search {aircraft ? `${aircraft} ` : ''}flights from {airport.iata}
        {airline ? ` on ${airline.toUpperCase()}` : ''} →
      </a>
    </aside>
  );
}

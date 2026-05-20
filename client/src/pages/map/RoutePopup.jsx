import { useEffect, useState } from 'react';
import { fetchRouteBrief } from './mapApi';
import styles from './Map.module.css';

function formatBlockTime(min) {
  if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

/**
 * Compact popup showing brief detail for a clicked route.
 *
 * Props:
 *   dep      string  IATA
 *   arr      string  IATA
 *   onClose  () => void
 */
export default function RoutePopup({ dep, arr, onClose }) {
  const [brief, setBrief] = useState(null);
  const [err, setErr]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    setBrief(null); setErr(null);
    fetchRouteBrief({ from: dep, to: arr })
      .then(d => { if (!cancelled) setBrief(d); })
      .catch(e => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [dep, arr]);

  const blockTime = brief && formatBlockTime(brief.blockTimeMinutes);
  const airlines  = Array.isArray(brief?.airlines) ? brief.airlines : [];
  const aircraft  = Array.isArray(brief?.aircraft) ? brief.aircraft : [];

  return (
    <div className={styles.routePopup} role="dialog" aria-label={`Route detail ${dep} to ${arr}`}>
      <button type="button" className={styles.routePopupClose} onClick={onClose} aria-label="Close route detail">×</button>
      <div className={styles.routePopupTitle}>
        <span className={styles.routePopupIata}>{dep}</span>
        <span className={styles.routePopupArrow}>→</span>
        <span className={styles.routePopupIata}>{arr}</span>
      </div>
      {blockTime && (
        <p className={styles.routePopupMeta}>Block time {blockTime}</p>
      )}
      {airlines.length > 0 && (
        <p className={styles.routePopupMeta}>
          Airlines: {airlines.slice(0, 4).map(a => a.name).join(', ')}{airlines.length > 4 ? '…' : ''}
        </p>
      )}
      {aircraft.length > 0 && (
        <p className={styles.routePopupMeta}>
          Aircraft: {aircraft.slice(0, 4).map(a => a.label).join(', ')}{aircraft.length > 4 ? '…' : ''}
        </p>
      )}
      {err && !brief && (
        <p className={styles.routePopupMeta}>Detail unavailable — see search results.</p>
      )}
      <a className={styles.routePopupCta} href={`/search?from=${encodeURIComponent(dep)}&to=${encodeURIComponent(arr)}`}>
        Search flights →
      </a>
    </div>
  );
}

import styles from './Map.module.css';

/**
 * Segmented control for switching between Network and Density visualization modes.
 *
 * @param {{value:'network'|'density', onChange:(v:'network'|'density')=>void}} props
 */
export default function MapViewToggle({ value, onChange }) {
  const select = (next) => { if (next !== value) onChange(next); };
  return (
    <div className={styles.viewToggle} role="group" aria-label="Map view mode">
      <button
        type="button"
        className={`${styles.viewToggleBtn} ${value === 'network' ? styles.viewToggleBtnActive : ''}`}
        aria-pressed={value === 'network'}
        onClick={() => select('network')}
      >
        Network
      </button>
      <button
        type="button"
        className={`${styles.viewToggleBtn} ${value === 'density' ? styles.viewToggleBtnActive : ''}`}
        aria-pressed={value === 'density'}
        onClick={() => select('density')}
      >
        Density
      </button>
    </div>
  );
}

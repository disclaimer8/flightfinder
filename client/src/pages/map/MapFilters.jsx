import { useState, useRef, useEffect } from 'react';
import styles from './Map.module.css';

/**
 * Floating chip-bar with `+ Add filter` combobox.
 *
 * Props:
 *   airline   string|null — current airline IATA
 *   aircraft  string|null — current aircraft ICAO
 *   options   { airlines: [{iata,name,count}], aircraft: [{icao,label,count}] }
 *   onChange  (next: {airline, aircraft}) => void
 */
export default function MapFilters({ airline, aircraft, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState('airline');
  const [query, setQuery] = useState('');
  const popoverRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const airlineMeta  = options?.airlines?.find(a => a.iata === airline);
  const aircraftMeta = options?.aircraft?.find(a => a.icao === aircraft);

  function selectAirline(iata) {
    onChange({ airline: iata, aircraft });
    setOpen(false);
    setQuery('');
  }
  function selectAircraft(icao) {
    onChange({ airline, aircraft: icao });
    setOpen(false);
    setQuery('');
  }

  const filteredAirlines = (options?.airlines || []).filter(a =>
    !query ||
    a.iata.toLowerCase().includes(query.toLowerCase()) ||
    a.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 50);

  const filteredAircraft = (options?.aircraft || []).filter(a =>
    !query ||
    a.icao.toLowerCase().includes(query.toLowerCase()) ||
    a.label.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 50);

  return (
    <div className={styles.filterBar} role="toolbar" aria-label="Map filters">
      <button
        type="button"
        className={styles.filterAddBtn}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        + Add filter
      </button>

      {airline && (
        <span className={styles.filterChip}>
          <span className={styles.filterChipLabel}>{airlineMeta?.name || airline}</span>
          <button
            type="button"
            className={styles.filterChipClose}
            onClick={() => onChange({ airline: null, aircraft })}
            aria-label="Remove airline filter"
          >×</button>
        </span>
      )}
      {aircraft && (
        <span className={styles.filterChip}>
          <span className={styles.filterChipLabel}>{aircraftMeta?.label || aircraft}</span>
          <button
            type="button"
            className={styles.filterChipClose}
            onClick={() => onChange({ airline, aircraft: null })}
            aria-label="Remove aircraft filter"
          >×</button>
        </span>
      )}

      {open && (
        <div className={styles.filterPopover} ref={popoverRef} role="dialog" aria-label="Choose filter">
          <div className={styles.filterTabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'airline'}
              className={`${styles.filterTab} ${tab === 'airline' ? styles.filterTabActive : ''}`}
              onClick={() => setTab('airline')}
            >Airline</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'aircraft'}
              className={`${styles.filterTab} ${tab === 'aircraft' ? styles.filterTabActive : ''}`}
              onClick={() => setTab('aircraft')}
            >Aircraft</button>
          </div>
          <input
            type="search"
            className={styles.filterSearch}
            placeholder={tab === 'airline' ? 'Filter by airline' : 'Filter by aircraft'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <ul className={styles.filterList}>
            {tab === 'airline' && filteredAirlines.map(a => (
              <li key={a.iata}>
                <button type="button" className={styles.filterOption} onClick={() => selectAirline(a.iata)}>
                  <span>{a.name}</span>
                  <span className={styles.filterOptionMeta}>{a.iata} · {a.count}</span>
                </button>
              </li>
            ))}
            {tab === 'aircraft' && filteredAircraft.map(a => (
              <li key={a.icao}>
                <button type="button" className={styles.filterOption} onClick={() => selectAircraft(a.icao)}>
                  <span>{a.label}</span>
                  <span className={styles.filterOptionMeta}>{a.icao} · {a.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

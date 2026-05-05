import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './AircraftIndex.module.css';

const CATEGORIES = [
  { value: 'all',         label: 'All' },
  { value: 'wide-body',   label: 'Wide-body' },
  { value: 'narrow-body', label: 'Narrow-body' },
  { value: 'regional',    label: 'Regional' },
  { value: 'turboprop',   label: 'Turboprop' },
];

export default function AircraftIndex() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState('all');
  const [stats, setStats] = useState({});
  const [popular, setPopular] = useState([]);

  useEffect(() => {
    let active = true;
    fetch('/content/aircraft-index.json')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(data => { if (active) setItems(data); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/aircraft/index-stats')
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (!active || !body) return;
        setStats(body.stats ?? {});
        setPopular(Array.isArray(body.popular) ? body.popular : []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const filtered = items?.filter(i => category === 'all' || i.category === category) ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1 className={styles.h1}>Aircraft browser</h1>
        <p className={styles.lede}>Explore routes, operators, and safety records — by aircraft type.</p>
      </header>

      {popular.length > 0 && (
        <section className={styles.popularStrip} aria-label="Most flown aircraft, last 14 days">
          <div className={styles.popularStripHead}>
            <span className={styles.popularStripEyebrow}>MOST FLOWN · LAST 14 DAYS</span>
          </div>
          <ul className={styles.popularStripRail}>
            {popular.map(p => (
              <li key={p.slug}>
                <Link to={`/aircraft/${p.slug}`} className={styles.popularStripPill}>
                  <span className={styles.popularStripPillName}>{p.label}</span>
                  <span className={styles.popularStripPillCount}>{p.routes14d}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className={styles.tabs} aria-label="Filter by category">
        {CATEGORIES.map(c => (
          <button
            key={c.value}
            type="button"
            className={`${styles.tab}${c.value === category ? ' ' + styles.tabActive : ''}`}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className={styles.fallback}>
          Couldn't load the aircraft list. <Link to="/">Return to search →</Link>
        </div>
      )}

      {!error && items === null && (
        <div className={styles.loading}>Aircraft browser is loading…</div>
      )}

      {!error && items !== null && (
        <ul className={styles.grid}>
          {filtered.map(item => (
            <li key={item.slug}>
              <Link to={`/aircraft/${item.slug}`} className={styles.tile}>
                <div className={styles.eyebrow}>{item.manufacturer.toUpperCase()}</div>
                <h2 className={styles.familyName}>{item.label}</h2>
                {item.tagline && <p className={styles.tagline}>{item.tagline}</p>}
                <div className={styles.statStrip}>
                  <span>{stats[item.slug]?.routeCount ?? '—'} ROUTES</span>
                  <span className={styles.dotSep}>·</span>
                  <span>{stats[item.slug]?.operatorCount ?? '—'} OPS</span>
                  <span className={styles.dotSep}>·</span>
                  <span>{stats[item.slug]?.safetyCount90d ?? 0} EVENTS / 90D</span>
                </div>
                <div className={styles.tileFooter}>
                  <span className={styles.categoryBadge}>{item.category.replace('-', ' ')}</span>
                  <span className={styles.cta}>View routes →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

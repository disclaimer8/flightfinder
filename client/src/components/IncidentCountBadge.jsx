import styles from './IncidentCountBadge.module.css';

const COLORS = {
  green: '#3a8d3a',
  yellow: '#c98b1f',
  red: '#c2362a',
};

export default function IncidentCountBadge({ level, count }) {
  const color = COLORS[level] || '#888';
  const text = count === 0
    ? 'No incidents 5y'
    : `${count} ${count === 1 ? 'incident' : 'incidents'} 5y`;
  return (
    <span className={styles.badge} style={{ borderColor: color, color }}>
      {text}
    </span>
  );
}

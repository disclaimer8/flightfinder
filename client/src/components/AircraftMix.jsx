import { Link } from 'react-router-dom';
import './AircraftMix.css';

export default function AircraftMix({ items }) {
  if (!items || items.length === 0) {
    return (
      <p className="aircraft-mix__empty">
        No aircraft observations yet on this route. Live ADS-B data populates within 7-14 days of first observation.
      </p>
    );
  }
  return (
    <ul className="aircraft-mix">
      {items.map(item => (
        <li key={item.slug} className="aircraft-mix__row">
          <Link to={`/aircraft/${item.slug}`} className="aircraft-mix__name">
            {item.label}
          </Link>
          <div className="aircraft-mix__bar" aria-hidden="true">
            <div className="aircraft-mix__bar-fill" style={{ width: `${item.share * 100}%` }} />
          </div>
          <span className="aircraft-mix__pct">{Math.round(item.share * 100)}%</span>
          <span className="aircraft-mix__count">({item.count} obs)</span>
        </li>
      ))}
    </ul>
  );
}

import { Link } from 'react-router-dom';
import './EnrichedTeaser.css';

const FEATURES = [
  'Airline livery + aircraft photo',
  'On-time performance for this exact flight',
  'CO₂ estimate by class',
  'Delay prediction for departure',
];

export default function EnrichedTeaser() {
  return (
    <div className="enriched-teaser" role="region" aria-label="Pro features preview">
      <div className="enriched-teaser__head">
        <span className="eyebrow eyebrow--strong">ENRICHED FLIGHT DATA</span>
        <span className="enriched-teaser__badge">Pro</span>
      </div>
      <ul className="enriched-teaser__list">
        {FEATURES.map(f => <li key={f}>{f}</li>)}
      </ul>
      <Link to="/pricing" className="enriched-teaser__cta">
        Unlock for $4.99/mo →
      </Link>
    </div>
  );
}

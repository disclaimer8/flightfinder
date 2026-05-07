import { Link } from 'react-router-dom';
import { AIRCRAFT_FAMILIES } from '../utils/aircraftFamilies';
import './AircraftBrowser.css';

// Top families to feature in the browse chips (ordered by popularity).
// The full list of 17 lives in aircraftFamilies.js — we surface the 10
// most-recognised models here; "See all →" covers the rest.
const FEATURED_SLUGS = [
  'boeing-787',
  'airbus-a380',
  'airbus-a350',
  'boeing-777',
  'airbus-a330',
  'boeing-747',
  'boeing-737',
  'airbus-a320',
  'airbus-a321',
  'embraer-e-jet',
];

const FEATURED = FEATURED_SLUGS
  .map(slug => AIRCRAFT_FAMILIES.find(f => f.slug === slug))
  .filter(Boolean);

// Short display labels for chips (drop the manufacturer prefix where obvious)
function shortLabel(family) {
  const label = family.label;
  // Boeing 787 Dreamliner → 787, Airbus A380 → A380, etc.
  const match = label.match(/(\d{3,}[\w-]*|A\d{3}[\w-]*|E-Jet|CRJ|ATR\s*\d+)/i);
  return match ? match[0] : label;
}

export default function AircraftBrowser() {
  return (
    <section className="aircraft-browser" aria-label="Browse by aircraft">
      <div className="ab-header">
        <h2 className="ab-title">Browse by aircraft</h2>
        <Link to="/aircraft" className="ab-see-all">See all →</Link>
      </div>
      <ul className="ab-chips">
        {FEATURED.map(family => (
          <li key={family.slug}>
            <Link
              to={`/aircraft/${family.slug}`}
              className="ab-chip"
              aria-label={family.label}
            >
              {shortLabel(family)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import './AircraftPillar.css';

const API = (import.meta.env.VITE_API_BASE || '');

const FIELD_LABELS = {
  manufacturer: 'Manufacturer',
  first_flight: 'First flight',
  in_service_since: 'In service since',
  variants: 'Variants',
  passenger_capacity_typical: 'Passenger capacity (typical)',
  max_range_km: 'Max range',
  max_takeoff_weight_kg: 'Max takeoff weight',
  wingspan_m: 'Wingspan',
  length_m: 'Length',
  height_m: 'Height',
  max_speed_kmh: 'Max speed',
  service_ceiling_m: 'Service ceiling',
  engines: 'Engine options',
  cabin_width_m: 'Cabin width',
  fuselage_material: 'Fuselage material',
};

const UNITS = {
  max_range_km: 'km',
  max_takeoff_weight_kg: 'kg',
  wingspan_m: 'm',
  length_m: 'm',
  height_m: 'm',
  max_speed_kmh: 'km/h',
  service_ceiling_m: 'm',
  cabin_width_m: 'm',
};

function fmtField(key, value) {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.join(', ');
  const unit = UNITS[key];
  if (unit) return `${value.toLocaleString()} ${unit}`;
  return String(value);
}

export default function AircraftSpecs() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/aircraft/${slug}/specs`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (active) setData(j.data); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [slug]);

  if (error) return <main className="ac-pillar"><h1>Specifications not available</h1></main>;
  if (!data) return <main className="ac-pillar"><p>Loading&#8230;</p></main>;

  return (
    <main className="ac-pillar">
      <nav className="ac-pillar__breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>{' › '}
        <Link to="/by-aircraft">By aircraft</Link>{' › '}
        <Link to={`/aircraft/${slug}`}>{slug}</Link>{' › '}
        <span>Specifications</span>
      </nav>
      <p className="ac-pillar__intro">
        This aircraft entered service in {data.in_service_since} and is built by{' '}
        {data.manufacturer}. Maximum range is{' '}
        {data.max_range_km ? `${data.max_range_km.toLocaleString()} km` : 'not listed'},{' '}
        accommodating {data.passenger_capacity_typical || '—'} passengers in
        typical configurations. The aircraft uses{' '}
        {data.engines && data.engines.length > 0 ? data.engines.join(' or ') : 'unspecified'} engines.
      </p>
      <section className="ac-pillar__specs">
        <h2 className="eyebrow eyebrow--strong">Specifications</h2>
        <table className="ac-pillar__specs-table">
          <tbody>
            {Object.keys(FIELD_LABELS).map((key) => (
              <tr key={key}>
                <th>{FIELD_LABELS[key]}</th>
                <td>{fmtField(key, data[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="ac-pillar__cross">
        <h2 className="eyebrow eyebrow--strong">Explore further</h2>
        <ul>
          <li><Link to={`/aircraft/${slug}`}>&#8592; Back to {slug} overview</Link></li>
          <li><Link to={`/aircraft/${slug}/airlines`}>Airlines that operate this aircraft &#8594;</Link></li>
          <li><Link to={`/aircraft/${slug}/routes`}>Routes flown by this aircraft &#8594;</Link></li>
          <li><Link to={`/aircraft/${slug}/safety`}>Safety record &#8594;</Link></li>
        </ul>
      </section>
    </main>
  );
}

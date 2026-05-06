import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './SampleCards.css';

export default function SampleCards() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    fetch('/content/landing/home.json')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(json => { if (active) setData(json); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (!data || !Array.isArray(data.sampleCards) || data.sampleCards.length === 0) return null;

  return (
    <section className="sample-cards" aria-label="Product highlights">
      <ul className="sample-cards-grid">
        {data.sampleCards.map(card => (
          <li key={card.headline}>
            <Link to={card.href} className="sample-card">
              <div className="eyebrow eyebrow--strong">{card.eyebrow}</div>
              <h3 className="sample-card-headline">{card.headline}</h3>
              <p className="sample-card-body">{card.body}</p>
              <span className="sample-card-cta">{card.cta} →</span>
            </Link>
          </li>
        ))}
      </ul>
      {data.browseAllAircraft && (
        <Link to={data.browseAllAircraft.href} className="sample-cards-browse">
          {data.browseAllAircraft.label} →
        </Link>
      )}
    </section>
  );
}

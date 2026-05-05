import './DataCard.css';

export default function DataCard({ rows }) {
  return (
    <aside className="data-card">
      <dl className="data-card__list">
        {rows.map(([label, value]) => (
          <div key={label} className="data-card__row">
            <dt className="data-card__label">{label}</dt>
            <dd className="data-card__value">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

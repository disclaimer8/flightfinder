import styles from './PricingCard.module.css';

export function PricingCard({
  tier, title, price, cadence,
  features, onSelect, highlight = false,
  remaining = null, soldOut = false,
  loading = false,
}) {
  const disabled = soldOut || loading;
  return (
    <div className={`${styles.card} ${highlight ? styles.highlight : ''}`}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.priceRow}>
        <span className={styles.price}>{price}</span>
        {cadence && <span className={styles.cadence}>{cadence}</span>}
      </div>
      {tier === 'pro_lifetime' && remaining != null && !soldOut && (
        <div className={styles.counter}>{remaining} slots left of 500</div>
      )}
      {soldOut && <div className={styles.soldOut}>Sold out</div>}
      <ul className={styles.features}>
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.cta}
        disabled={disabled}
        onClick={() => onSelect(tier)}
      >
        {loading ? 'Redirecting…' : soldOut ? 'Sold out' : 'Subscribe'}
      </button>
    </div>
  );
}

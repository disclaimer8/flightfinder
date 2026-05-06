import styles from './PricingCard.module.css';
import Button from './Button';

export function PricingCard({
  tier,
  eyebrow,
  title,
  price,
  cadence,
  features,
  onSelect,
  highlight = false,
  remaining = null,
  soldOut = false,
  loading = false,
}) {
  const disabled = soldOut || loading;
  return (
    <article
      className={`${styles.card}${highlight ? ' ' + styles.cardHighlight : ''}`}
      aria-label={title}
    >
      {highlight && <span className={styles.recommendedRibbon}>RECOMMENDED</span>}
      <div className={styles.eyebrow}>{eyebrow}</div>
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
      <Button
        variant="primary"
        disabled={disabled}
        onClick={() => onSelect(tier)}
      >
        {loading ? 'Redirecting…' : soldOut ? 'Sold out' : 'Subscribe'}
      </Button>
    </article>
  );
}

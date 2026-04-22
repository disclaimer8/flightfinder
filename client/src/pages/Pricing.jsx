import { Link } from 'react-router-dom';
import { PricingCard } from '../components/PricingCard.jsx';
import { useLifetimeStatus } from '../hooks/useLifetimeStatus.js';
import { useCheckout } from '../hooks/useCheckout.js';
import { isNativeApp } from '../utils/platform.js';
import styles from './Pricing.module.css';

const TIERS = [
  {
    tier: 'pro_monthly',
    title: 'Pro Monthly',
    price: '$4.99',
    cadence: '/month',
    features: [
      'Enriched flight card (livery, aircraft, on-time, CO₂)',
      'Delay predictions',
      'My Trips with web-push alerts',
      'Cancel anytime',
    ],
  },
  {
    tier: 'pro_annual',
    title: 'Pro Annual',
    price: '$39',
    cadence: '/year',
    features: [
      'Everything in Pro Monthly',
      'Save 35% vs monthly',
      '2 months free',
    ],
    highlight: true,
  },
  {
    tier: 'pro_lifetime',
    title: 'Pro Lifetime',
    price: '$99',
    cadence: 'once',
    features: [
      'Everything in Pro Annual',
      'Lifetime access — pay once',
      'Limited to 500 founders',
    ],
  },
];

export default function Pricing() {
  const { status } = useLifetimeStatus();
  const { start, loading, error } = useCheckout();

  if (isNativeApp()) {
    return (
      <div className={styles.nativeNotice}>
        <h2>Manage subscription on the web</h2>
        <p>Pricing and checkout are available at <a href="https://himaxym.com/pricing">himaxym.com/pricing</a>.</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1>Choose your plan</h1>
        <p>Unlock enriched flight data, delay predictions, and My Trips.</p>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <div className={styles.grid}>
        {TIERS.map((t) => (
          <PricingCard
            key={t.tier}
            {...t}
            remaining={t.tier === 'pro_lifetime' ? status?.remaining : null}
            soldOut={t.tier === 'pro_lifetime' ? !!status?.soldOut : false}
            loading={loading}
            onSelect={start}
          />
        ))}
      </div>

      <footer className={styles.legal}>
        <p>
          Subscriptions auto-renew. Cancel anytime via the billing portal.
          Lifetime is capped at 500 slots and, per EU rules, the 14-day right of
          withdrawal is waived once you gain access.{' '}
          <Link to="/legal/terms">Terms</Link> · <Link to="/legal/privacy">Privacy</Link>
        </p>
        <p>Payments processed by Stripe. Taxes calculated automatically.</p>
      </footer>
    </div>
  );
}

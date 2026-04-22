import styles from './legal.module.css';

export default function Privacy() {
  return (
    <article className={styles.page}>
      <h1>Privacy Policy</h1>
      <p className={styles.meta}>Effective: 2026-04-22.</p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account:</strong> email address, hashed password, verification status.</li>
        <li><strong>Subscription:</strong> Stripe customer ID, subscription ID, tier, validity dates. We never see your card number.</li>
        <li><strong>Trips (My Trips):</strong> flight numbers, dates, routes you choose to save.</li>
        <li><strong>Push subscriptions:</strong> endpoint URL and encryption keys supplied by your browser's Push service.</li>
        <li><strong>Usage telemetry:</strong> anonymised request logs, error reports via Sentry (EU region).</li>
      </ul>

      <h2>2. Data we share</h2>
      <ul>
        <li><strong>Stripe</strong> — to process payments and manage subscriptions.</li>
        <li><strong>Mailgun</strong> — to send transactional email (verification, receipts, alerts).</li>
        <li><strong>Sentry</strong> — to diagnose errors.</li>
        <li><strong>Browser push services</strong> (e.g. Google FCM, Mozilla autopush) — to deliver notifications you opted into.</li>
      </ul>
      <p>We do not sell data to third parties or run advertising trackers.</p>

      <h2>3. Cookies</h2>
      <p>
        We use one session cookie for authentication and a Stripe checkout cookie during checkout. No marketing
        or analytics cookies.
      </p>

      <h2>4. Data retention</h2>
      <ul>
        <li>Account + subscription records: kept while your account exists; deleted within 30 days of account deletion.</li>
        <li>Trips: deleted with your account or on request.</li>
        <li>Push endpoints: deleted when unsubscribed by your browser or by you.</li>
        <li>Error logs: retained 90 days in Sentry.</li>
      </ul>

      <h2>5. Your rights (GDPR / UK GDPR)</h2>
      <p>
        You may request access, correction, export, or deletion of your data by emailing
        <a href="mailto:support@himaxym.com"> support@himaxym.com</a>. We respond within 30 days.
      </p>

      <h2>6. Data location</h2>
      <p>Hosting is in the EU (Hetzner). Stripe and Sentry operate in the EU region.</p>

      <h2>7. Children</h2>
      <p>The Service is not directed at users under 16.</p>

      <h2>8. Changes</h2>
      <p>We will notify registered users by email for material changes.</p>
    </article>
  );
}

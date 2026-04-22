import styles from './legal.module.css';

export default function Terms() {
  return (
    <article className={styles.page}>
      <h1>Terms of Service</h1>
      <p className={styles.meta}>Effective: 2026-04-22. Last updated: 2026-04-22.</p>

      <h2>1. Who we are</h2>
      <p>
        himaxym.com ("the Service") is operated by the site owner, reachable at
        <a href="mailto:support@himaxym.com"> support@himaxym.com</a>.
      </p>

      <h2>2. Account and access</h2>
      <p>You must provide a valid email and keep credentials secure. You may delete your account at any time.</p>

      <h2>3. Subscriptions</h2>
      <ul>
        <li><strong>Pro Monthly ($4.99/month)</strong> — auto-renews every month until cancelled.</li>
        <li><strong>Pro Annual ($39/year)</strong> — auto-renews every 12 months until cancelled.</li>
        <li><strong>Pro Lifetime ($99 one-time)</strong> — one-time payment for continued access while the Service operates. Limited to 500 total purchases.</li>
      </ul>

      <h2>4. Billing and taxes</h2>
      <p>
        Payments are processed by Stripe, Inc. Taxes are calculated automatically at checkout based on your
        location. We do not store card numbers.
      </p>

      <h2>5. Refunds and cancellation</h2>
      <p>
        You may cancel monthly or annual subscriptions at any time via the billing portal; access continues until
        the end of the paid period. Refunds on recurring charges are granted within 7 days of the most recent
        renewal at our discretion.
      </p>
      <p>
        <strong>EU right of withdrawal (14 days):</strong> where the 2011/83/EU Consumer Rights Directive applies,
        you have 14 days to withdraw from a purchase. By starting to use the Pro features immediately after
        payment, you expressly consent to waive this right for the Lifetime plan; for Monthly and Annual plans,
        withdrawal within 14 days entitles you to a prorated refund for unused time.
      </p>

      <h2>6. Service availability</h2>
      <p>
        Flight data is provided best-effort from third-party sources (AeroDataBox, adsb.lol, Travelpayouts,
        OpenWeather) and may be incomplete or delayed. We do not guarantee accuracy. Do not use this Service as
        the sole source of truth for flight booking or operational decisions.
      </p>

      <h2>7. Acceptable use</h2>
      <p>No scraping, automated bulk queries, resale of data, or reverse-engineering.</p>

      <h2>8. Termination</h2>
      <p>
        We may suspend or terminate accounts that violate these Terms. On termination we will refund any unused
        portion of a Monthly or Annual subscription. Lifetime buyers who are terminated for fraud or abuse are not
        entitled to a refund.
      </p>

      <h2>9. Changes</h2>
      <p>We may update these Terms with 30 days notice by email for material changes.</p>

      <h2>10. Governing law</h2>
      <p>These Terms are governed by the laws applicable at the operator's registered residence, without regard to conflict-of-laws rules.</p>
    </article>
  );
}

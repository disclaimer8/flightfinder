import { Link } from 'react-router-dom';
import MetaLine from '../components/MetaLine';
import styles from './About.module.css';

export default function About() {
  return (
    <article className={styles.page}>
      <h1>About FlightFinder</h1>
      <MetaLine effective="2026-05-06" lastUpdated="2026-05-06" />

      <h2>What FlightFinder is</h2>
      <p>FlightFinder is a flight search engine built around aircraft type. Most search engines optimize for price; we optimize for the question "which plane will I actually fly on?" Routes, operators, and live schedules are filterable by manufacturer, family, and model — Boeing 737, Airbus A320, Embraer E195, ATR 72 and more. The site also publishes a global aviation safety database aggregated from public sources, kept up to date weekly.</p>

      <h2>Data sources and methodology</h2>
      <p><strong>Schedules and fares</strong> come from AeroDataBox, Travelpayouts, and Amadeus. Refreshed every 4 hours.</p>
      <p><strong>Observed routes</strong> (which aircraft actually flew a given city pair) come from adsb.lol's open ADS-B network under the Open Database License. Refreshed daily.</p>
      <p><strong>Aircraft families and registrations</strong> come from FAA, OpenFlights, and OurAirports. Refreshed quarterly.</p>
      <p><strong>Aviation safety data</strong> combines NTSB CAROL (United States, daily), the Aviation Safety Network and B3A archives via Wikidata (worldwide, weekly).</p>
      <p><strong>Weather</strong> comes from NOAA METAR feeds and OpenWeather.</p>
      <p>Live schedules can be incomplete or delayed — third-party APIs occasionally return partial data. We do not edit, redact, or curate accident records; we present public datasets as-is. Routes with fewer than 5 observed flights in the last 14 days do not get dedicated landing pages to avoid thin content.</p>

      <h2>Open-source acknowledgments</h2>
      <p>FlightFinder is built on open-source software including React, Vite, Express, better-sqlite3, Leaflet, react-router, and many others. Per-package licenses are listed at <Link to="/legal/attributions">/legal/attributions</Link>. Aggregated public datasets are used under their respective licenses (ODbL for adsb.lol, CC0/CC-BY-SA for Wikidata, public domain for NTSB).</p>

      <h2>Editorial policy</h2>
      <p>We do not edit accident records, alter fatality counts, or curate which incidents appear. Aggregated data flows from public sources (NTSB, ASN, B3A, Wikidata) directly into the FlightFinder database with deduplication by source URL. Live flight schedules are sourced from third-party APIs and may differ from what you see at booking time — always verify with your airline before travel.</p>

      <h2>Contact</h2>
      <p>Email: <a href="mailto:support@himaxym.com">support@himaxym.com</a></p>
      <p>Site: <a href="https://himaxym.com">https://himaxym.com</a></p>

      <p>
        See also: <Link to="/legal/terms">Terms</Link> ·{' '}
        <Link to="/legal/privacy">Privacy</Link> ·{' '}
        <Link to="/legal/attributions">Attributions</Link>
      </p>
    </article>
  );
}

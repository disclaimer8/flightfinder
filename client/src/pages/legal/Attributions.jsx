import { Link } from 'react-router-dom';
import styles from './legal.module.css';

export default function Attributions() {
  return (
    <article className={styles.page}>
      <h1>Data attributions</h1>
      <p>FlightFinder credits the following public sources of aviation data:</p>
      <ul>
        <li>
          <strong>NTSB CAROL</strong> — U.S. National Transportation Safety Board
          accident and incident database. Data is in the public domain. See{' '}
          <a href="https://data.ntsb.gov/" rel="nofollow noopener noreferrer">data.ntsb.gov</a>.
        </li>
        <li>
          <strong>OpenFlights</strong> — airport and airline reference data, ODbL license.
        </li>
        <li>
          <strong>OurAirports</strong> — supplementary airport metadata, public domain.
        </li>
        <li>
          <strong>NOAA Aviation Weather</strong> — METAR feeds.
        </li>
        <li>
          <strong>Wikimedia Commons</strong> — aircraft livery photos, license per image.
        </li>
      </ul>
      <p>
        FlightFinder is not affiliated with, endorsed by, or sponsored by any of the above
        organizations. Safety data is shown for informational purposes only and may lag the
        official source.
      </p>
      <p>
        See also: <Link to="/legal/privacy">Privacy</Link> · <Link to="/legal/terms">Terms</Link>
      </p>
    </article>
  );
}

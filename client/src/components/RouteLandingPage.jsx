import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import SkeletonResults from './SkeletonResults';
import './AircraftLandingPage.css';

// /routes/:pair where :pair is "lhr-jfk" (IATA, lowercase). We resolve
// city names via the same /api/aircraft/airports/search endpoint the
// main form uses, so we don't duplicate the airport catalogue client-
// side.
export default function RouteLandingPage() {
  const { pair } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    const m = /^([a-z]{3})-([a-z]{3})$/i.exec(pair || '');
    if (!m) {
      setState({ status: 'invalid' });
      return;
    }
    const from = m[1].toUpperCase();
    const to   = m[2].toUpperCase();
    Promise.all([
      fetch(`${API_BASE}/api/aircraft/airports/search?q=${from}&limit=1`).then((r) => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/aircraft/airports/search?q=${to}&limit=1`).then((r) => r.json()).catch(() => null),
    ]).then(([fromRes, toRes]) => {
      const fromAp = fromRes?.airports?.[0] || fromRes?.results?.[0] || null;
      const toAp   = toRes?.airports?.[0]   || toRes?.results?.[0]   || null;
      setState({
        status: 'ok',
        from: { iata: from, city: fromAp?.city || from, name: fromAp?.name || from, country: fromAp?.country || '' },
        to:   { iata: to,   city: toAp?.city   || to,   name: toAp?.name   || to,   country: toAp?.country   || '' },
      });
    });
  }, [pair]);

  if (state.status === 'loading') return <SkeletonResults message="Loading route…" />;
  if (state.status === 'invalid') {
    return (
      <div className="landing landing--not-found">
        <h1>Route not found</h1>
        <p>The URL should look like <code>/routes/lhr-jfk</code> — three-letter IATA codes separated by a dash.</p>
        <Link to="/" className="landing-cta">Go to search</Link>
      </div>
    );
  }

  const { from, to } = state;
  return (
    <div className="landing">
      <nav className="landing-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">&rsaquo;</span>
        <span>Routes</span>
        <span aria-hidden="true">&rsaquo;</span>
        <span>{from.iata} &rarr; {to.iata}</span>
      </nav>

      <header className="landing-header">
        <span className="landing-badge">Route</span>
        <h1 className="landing-h1">{from.city} to {to.city} flights</h1>
        <p className="landing-sub">
          Direct and connecting flights from {from.name} ({from.iata}) to {to.name} ({to.iata}).
          Compare airlines, aircraft types, and fares on one page — or run a full search for specific dates below.
        </p>
        <div className="landing-cta-row">
          <button
            type="button"
            className="landing-cta"
            onClick={() => navigate(`/?from=${from.iata}&to=${to.iata}`)}
          >
            Search {from.iata} &rarr; {to.iata} flights
          </button>
        </div>
      </header>

      <section className="landing-siblings">
        <h2>Explore more</h2>
        <ul className="landing-siblings-list">
          <li><Link to={`/routes/${to.iata.toLowerCase()}-${from.iata.toLowerCase()}`}>{to.iata} &rarr; {from.iata} (return)</Link></li>
          <li><Link to="/">Search other routes</Link></li>
          <li><Link to="/by-aircraft">Search by aircraft type</Link></li>
          <li><Link to="/map">Global route map</Link></li>
        </ul>
      </section>
    </div>
  );
}

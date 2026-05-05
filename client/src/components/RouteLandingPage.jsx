import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import SkeletonResults from './SkeletonResults';
import './AircraftLandingPage.css';

// Route landing copy (FAQ + tips template) lives in
// client/public/content/landing/route.json — split out of the bundle in
// batch 4. The blurb uses {from.city}/{to.city}/{from.iata}/{to.iata}
// placeholders that interpolate() resolves at render.

// Replace {from.city}, {from.iata}, {to.city}, {to.iata} placeholders
// with the resolved airport values. Kept inline because this is the only
// call site.
function interpolate(tpl, from, to) {
  return tpl
    .replace(/\{from\.city\}/g, from.city)
    .replace(/\{from\.iata\}/g, from.iata)
    .replace(/\{to\.city\}/g, to.city)
    .replace(/\{to\.iata\}/g, to.iata);
}

// /routes/:pair where :pair is "lhr-jfk" (IATA, lowercase). We resolve
// city names via the same /api/aircraft/airports/search endpoint the
// main form uses, so we don't duplicate the airport catalogue client-
// side.
export default function RouteLandingPage() {
  const { pair } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading' });
  // Aircraft families observed on this city pair (last 90 days). Drives the
  // cross-link rail back to /aircraft/:slug landing pages.
  const [aircraft, setAircraft] = useState([]);
  const [routeCopy, setRouteCopy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/content/landing/route.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setRouteCopy(data); })
      .catch(() => { /* render falls back to no FAQ / no tips blurb */ });
    return () => { cancelled = true; };
  }, []);

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

  // Fetch observed aircraft families for cross-linking. Independent of
  // the airport-name lookup so the page header isn't blocked.
  useEffect(() => {
    const m = /^([a-z]{3})-([a-z]{3})$/i.exec(pair || '');
    if (!m) return;
    const dep = m[1].toUpperCase();
    const arr = m[2].toUpperCase();
    let cancelled = false;
    fetch(`${API_BASE}/api/map/route-aircraft?dep=${dep}&arr=${arr}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.families) ? data.families : [];
        setAircraft(list);
      })
      .catch(() => { /* non-critical — cross-links just won't render */ });
    return () => { cancelled = true; };
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
          Compare airlines, aircraft types, and fares on one page.
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

      {routeCopy?.tipsBlurb && (
        <section className="landing-prose">
          <h2>Booking tips for {from.city} &rarr; {to.city}</h2>
          <p>{interpolate(routeCopy.tipsBlurb, from, to)}</p>
        </section>
      )}

      {aircraft.length > 0 && (
        <section className="landing-top-routes">
          <h2>Aircraft flying {from.iata} &rarr; {to.iata}</h2>
          <p className="landing-map-hint">
            Families observed on this city pair in the last 90 days. Click any aircraft to see its global route map.
          </p>
          <ul className="landing-siblings-list">
            {aircraft.map((f) => (
              <li key={f.slug}>
                <Link to={`/aircraft/${f.slug}`}>{f.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {Array.isArray(routeCopy?.faq) && routeCopy.faq.length > 0 && (
        <section className="landing-faq">
          <h2>Frequently asked questions about {from.iata} &rarr; {to.iata}</h2>
          {routeCopy.faq.map((qa, i) => (
            <details key={i} className="landing-faq-item" open={i === 0}>
              <summary>{interpolate(qa.q, from, to)}</summary>
              <p>{interpolate(qa.a, from, to)}</p>
            </details>
          ))}
        </section>
      )}

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

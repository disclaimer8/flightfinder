import { useEffect, useState, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import SkeletonResults from './SkeletonResults';
import './AircraftLandingPage.css';

const AircraftRouteMap = lazy(() => import('./AircraftRouteMap'));

// Module-level promise cache for the global safety dataset. Avoids re-fetching
// 200 accident rows every time the user navigates between aircraft landing
// pages in the same session. The endpoint returns up to ~5K rows so this
// noticeably reduces redundant network traffic on browse-flows.
let _globalAccidentsPromise = null;
function fetchGlobalAccidentsCached() {
  if (_globalAccidentsPromise) return _globalAccidentsPromise;
  _globalAccidentsPromise = fetch(`${API_BASE}/api/safety/global/accidents?limit=200`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(body => Array.isArray(body?.data) ? body.data : [])
    .catch(err => {
      // Evict on error so a future visit can retry.
      _globalAccidentsPromise = null;
      throw err;
    });
  return _globalAccidentsPromise;
}

// Build a regex that matches the family stem at the start of aircraft_model.
// Slug "boeing-737" → /^Boeing 737/i, "airbus-a320" → /^Airbus A320/i.
//
// Strip the "-family" suffix that some slugs carry (e.g. "airbus-a320-family"):
// the underlying aircraft_model strings are concrete variants ("Airbus A320-200",
// "Airbus A321") and never start with "Airbus A320 Family". Without this strip
// the family landing page rendered an empty safety section.
function familyMatchRegex(slug) {
  if (!slug) return null;
  const cleaned = slug.replace(/-family$/, '');
  const stem = cleaned
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
}

// Best-effort sort by date string. The backend ships the original spelling
// (e.g. "12 Feb 2024", "xx Oct 2024") — we use Date.parse and fall back to 0
// for unparseable strings, treating those as oldest. Works "good enough" to
// surface the top 5 most recent.
function bestEffortDate(s) {
  if (!s) return 0;
  // Replace 'xx' day with '01' so months-only strings still parse.
  const cleaned = String(s).replace(/^xx\s+/i, '01 ');
  const t = Date.parse(cleaned);
  return Number.isFinite(t) ? t : 0;
}

function firstUrl(raw) {
  if (!raw) return null;
  const first = String(raw).split(',')[0].trim();
  return first || null;
}

// Per-slug landing copy lives in client/public/content/landing/aircraft/<slug>.json
// — split out of the bundle in batch 4 so the AircraftLandingPage chunk dropped
// from ~50KB raw to ~5KB. The JSON is fetched in parallel with /api/aircraft/families
// so it doesn't add a serial wait.
export default function AircraftLandingPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [families, setFamilies] = useState([]);
  const [fam, setFam] = useState(null);
  const [copy, setCopy] = useState(null);
  const [error, setError] = useState(null);
  // Top observed city pairs for this family (cross-linking to /routes/:pair).
  const [topRoutes, setTopRoutes] = useState([]);
  // Recent safety events for this aircraft type (from global safety dataset).
  // null = loading, [] = none found, [event,...] = matched.
  const [safetyEvents, setSafetyEvents] = useState(null);
  const [safetyError, setSafetyError]   = useState(null);

  useEffect(() => {
    // Fetch the full family list once — we need it to resolve slug → display
    // name and to render a sibling-browse rail at the bottom.
    fetch(`${API_BASE}/api/aircraft/families`)
      .then((r) => r.json())
      .then((data) => {
        const list = data?.families || [];
        setFamilies(list);
        const match = list.find((f) => f.slug === slug);
        if (!match) {
          setError('unknown-family');
          return;
        }
        setFam(match);
      })
      .catch(() => setError('fetch-failed'));
  }, [slug]);

  // Load landing copy for this slug. 404 → fall through to the generic copy
  // assembled in the render branch below (slugs without bespoke copy still
  // render, just with a templated hint and empty overview/operators/faq).
  useEffect(() => {
    let cancelled = false;
    setCopy(null);
    fetch(`/content/landing/aircraft/${slug}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setCopy(data); })
      .catch(() => { /* render falls through to generic copy */ });
    return () => { cancelled = true; };
  }, [slug]);

  // Pull top observed routes for this family (global, all origins) so we can
  // render a cross-link rail to /routes/:pair landing pages. Independent of
  // the AircraftRouteMap fetch because that component takes an `origins` prop
  // and we want the absolute top globally.
  useEffect(() => {
    if (!fam) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/aircraft/routes?family=${encodeURIComponent(fam.slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const routes = Array.isArray(data?.routes) ? data.routes.slice(0, 12) : [];
        setTopRoutes(routes);
      })
      .catch(() => { /* non-critical — cross-links just won't render */ });
    return () => { cancelled = true; };
  }, [fam]);

  // Pull recent safety events for this aircraft type from the global dataset.
  // We filter client-side because the backend doesn't expose a model filter,
  // and the cached promise means subsequent aircraft pages reuse this fetch.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setSafetyEvents(null);
    setSafetyError(null);

    const re = familyMatchRegex(slug);
    fetchGlobalAccidentsCached()
      .then(rows => {
        if (cancelled) return;
        const matched = re
          ? rows.filter(r => r.aircraft_model && re.test(r.aircraft_model))
          : [];
        matched.sort((a, b) => bestEffortDate(b.date) - bestEffortDate(a.date));
        setSafetyEvents(matched.slice(0, 5));
      })
      .catch(err => { if (!cancelled) setSafetyError(err.message); });

    return () => { cancelled = true; };
  }, [slug]);

  if (error === 'unknown-family') {
    return (
      <div className="landing landing--not-found">
        <h1>Aircraft not found</h1>
        <p>We don&rsquo;t have route data for <code>{slug}</code>. Try one of these instead:</p>
        <Link to="/by-aircraft" className="landing-cta">Browse all aircraft</Link>
      </div>
    );
  }

  if (!fam) {
    return <SkeletonResults message="Loading aircraft data…" />;
  }

  const resolvedCopy = copy || {
    hint: `The ${fam.label} is used on commercial routes worldwide. Explore every city pair it serves below.`,
    overview: null,
    operators: null,
    faq: null,
  };

  return (
    <div className="landing">
      <nav className="landing-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">&rsaquo;</span>
        <Link to="/by-aircraft">By aircraft</Link>
        <span aria-hidden="true">&rsaquo;</span>
        <span>{fam.label}</span>
      </nav>

      <header className="landing-header">
        <span className="landing-badge">{fam.manufacturer} &middot; {fam.type}</span>
        <h1 className="landing-h1">{fam.label} flights and routes</h1>
        <p className="landing-sub">{resolvedCopy.hint}</p>
        <div className="landing-cta-row">
          <button
            type="button"
            className="landing-cta"
            onClick={() => navigate('/by-aircraft')}
          >
            Search flights on the {fam.label}
          </button>
        </div>
      </header>

      {resolvedCopy.overview && (
        <section className="landing-prose">
          <h2>About the {fam.label}</h2>
          <p>{resolvedCopy.overview}</p>
          {resolvedCopy.operators && (
            <>
              <h3>Who flies it?</h3>
              <p>{resolvedCopy.operators}</p>
            </>
          )}
        </section>
      )}

      <section className="landing-safety">
        <h2>Recent safety events for the {fam.label}</h2>
        {safetyError && (
          <p className="landing-safety-empty">
            Couldn&rsquo;t load safety records right now.
          </p>
        )}
        {!safetyError && safetyEvents === null && (
          <p className="landing-safety-empty">Loading safety records…</p>
        )}
        {!safetyError && safetyEvents && safetyEvents.length === 0 && (
          <p className="landing-safety-empty">
            No accidents on file for this aircraft type. That&rsquo;s a good sign.
          </p>
        )}
        {!safetyError && safetyEvents && safetyEvents.length > 0 && (
          <ul className="landing-safety-list">
            {safetyEvents.map(ev => {
              const url = firstUrl(ev.source_url);
              return (
                <li key={ev.id} className="landing-safety-item">
                  <span className="landing-safety-date">{ev.date || '—'}</span>
                  <div className="landing-safety-body">
                    <div className="landing-safety-meta">
                      <strong>{ev.operator || 'Operator unknown'}</strong>
                      {ev.location && <span> · {ev.location}</span>}
                      {ev.fatalities && ev.fatalities !== '0' && (
                        <span className="landing-safety-fatal">
                          {ev.fatalities} fatalities
                        </span>
                      )}
                    </div>
                    {url && (
                      <a
                        className="landing-safety-link"
                        href={url}
                        target="_blank"
                        rel="nofollow noopener noreferrer"
                      >
                        Read the {ev.operator || 'operator'} {ev.date || ''} report →
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {safetyEvents && safetyEvents.length > 0 && (
          <p className="landing-safety-hint">
            Source: <Link to="/safety/global">global aviation safety dataset</Link>{' '}
            (Aviation Safety Network, B3A, Wikidata).
          </p>
        )}
      </section>

      <section className="landing-map">
        <h2>Where does the {fam.label} fly?</h2>
        <p className="landing-map-hint">
          Live map of every city pair we&rsquo;ve observed the {fam.label} serving in the last 14 days.
          Click any destination to see flights.
        </p>
        <div className="landing-map-frame">
          <Suspense fallback={<SkeletonResults message="Loading route map…" />}>
            <AircraftRouteMap
              familyName={fam.label}
              family={fam.name}
              date={null}
              passengers={1}
              originIatas={[]}
              onBack={null}
            />
          </Suspense>
        </div>
      </section>

      {topRoutes.length > 0 && (
        <section className="landing-top-routes">
          <h2>Top routes flown by the {fam.label}</h2>
          <p className="landing-map-hint">
            City pairs we&rsquo;ve observed most often in the last 14 days. Click any route to see flights.
          </p>
          <ul className="landing-siblings-list">
            {topRoutes.map((r) => (
              <li key={`${r.dep}-${r.arr}`}>
                <Link to={`/routes/${r.dep.toLowerCase()}-${r.arr.toLowerCase()}`}>
                  {r.dep} &rarr; {r.arr}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {Array.isArray(resolvedCopy.faq) && resolvedCopy.faq.length > 0 && (
        <section className="landing-faq">
          <h2>Frequently asked questions about the {fam.label}</h2>
          {resolvedCopy.faq.map((qa, i) => (
            <details key={i} className="landing-faq-item" open={i === 0}>
              <summary>{qa.q}</summary>
              <p>{qa.a}</p>
            </details>
          ))}
        </section>
      )}

      <section className="landing-siblings">
        <h2>Other aircraft you can search</h2>
        <ul className="landing-siblings-list">
          {families
            .filter((f) => f.slug !== slug)
            .slice(0, 12)
            .map((f) => (
              <li key={f.slug}>
                <Link to={`/aircraft/${f.slug}`}>{f.label}</Link>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

import { useEffect, useState, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import SkeletonResults from './SkeletonResults';
import { AIRCRAFT_COPY } from '../content/landingCopy';
import './AircraftLandingPage.css';

const AircraftRouteMap = lazy(() => import('./AircraftRouteMap'));

export default function AircraftLandingPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [families, setFamilies] = useState([]);
  const [fam, setFam] = useState(null);
  const [error, setError] = useState(null);
  // Top observed city pairs for this family (cross-linking to /routes/:pair).
  const [topRoutes, setTopRoutes] = useState([]);

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

  const copy = AIRCRAFT_COPY[slug] || {
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
        <p className="landing-sub">{copy.hint}</p>
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

      {copy.overview && (
        <section className="landing-prose">
          <h2>About the {fam.label}</h2>
          <p>{copy.overview}</p>
          {copy.operators && (
            <>
              <h3>Who flies it?</h3>
              <p>{copy.operators}</p>
            </>
          )}
        </section>
      )}

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

      {Array.isArray(copy.faq) && copy.faq.length > 0 && (
        <section className="landing-faq">
          <h2>Frequently asked questions about the {fam.label}</h2>
          {copy.faq.map((qa, i) => (
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

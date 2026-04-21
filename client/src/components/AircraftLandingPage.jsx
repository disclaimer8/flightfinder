import { useEffect, useState, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import SkeletonResults from './SkeletonResults';
import './AircraftLandingPage.css';

const AircraftRouteMap = lazy(() => import('./AircraftRouteMap'));

// Static descriptive copy per family. Keyed by slug. Unknown slugs fall
// through to a generic paragraph — the backend seoMetaService still does
// its own 404 handling for meta tags.
const COPY = {
  'boeing-737':      { hint: "The Boeing 737 is the world's best-selling narrow-body — from the MAX 8 on short-haul hops to the 737-800 workhorses that still anchor most low-cost fleets." },
  'boeing-757':      { hint: 'The Boeing 757 is the transatlantic narrow-body: long legs, steep-climb performance, and the last US-built single-aisle jet for charter and legacy operators.' },
  'boeing-767':      { hint: 'The Boeing 767 is a mid-size wide-body still common on transatlantic and freight routes, slowly being replaced by the 787.' },
  'boeing-777':      { hint: 'The Boeing 777 is the long-haul backbone of most legacy carriers — the 777-300ER carries 300+ passengers across any ocean in the world.' },
  'boeing-787':      { hint: 'The Boeing 787 Dreamliner is the modern long-haul choice: lower cabin altitude, larger windows, and routes that open city pairs the 747 never could.' },
  'boeing-747':      { hint: 'The Boeing 747 — Queen of the Skies — is being retired from passenger service worldwide but still flies select routes with Lufthansa, Korean Air, and Air China.' },
  'airbus-a340':     { hint: 'The Airbus A340 is a four-engine long-hauler mostly retired from major carriers — Lufthansa, SWISS, and Mahan still operate a shrinking fleet.' },
  'airbus-a220':     { hint: 'The Airbus A220 (ex-Bombardier CSeries) is a clean-sheet narrow-body that Delta, airBaltic, and Swiss use for regional and thin mid-range routes.' },
  'airbus-a319':     { hint: 'The Airbus A319 is the shortest A320-family variant — common on regional European routes and North American LCC fleets.' },
  'airbus-a320':     { hint: 'The Airbus A320 is the universal narrow-body standard — operated by almost every major airline worldwide, from low-cost to legacy.' },
  'airbus-a321':     { hint: 'The Airbus A321 (and the NEO / LR / XLR variants) extends the A320 family to transatlantic range on a single-aisle airframe.' },
  'airbus-a320-family': { hint: 'The A320 family covers the A318, A319, A320, and A321 — the most-flown narrow-body family in commercial aviation.' },
  'airbus-a330':     { hint: 'The Airbus A330 is a twin-engine wide-body used on medium-to-long-haul routes worldwide. The A330neo is the current re-engined variant.' },
  'airbus-a350':     { hint: 'The Airbus A350 XWB is the newest long-haul wide-body — used by Qatar, Singapore, Cathay, and ANA on ultra-long routes like Auckland-Doha.' },
  'airbus-a380':     { hint: 'The Airbus A380 is the double-deck super-jumbo — Emirates, British Airways, Qantas, Singapore Airlines, and Lufthansa still fly it on select high-density routes.' },
  'embraer-e170-e175': { hint: 'The Embraer E170/E175 is the regional jet workhorse of US major carriers and European regional subsidiaries.' },
  'embraer-e190-e195': { hint: 'The Embraer E190/E195 is a larger regional / small mainline jet used by airBaltic, KLM Cityhopper, and Helvetic on secondary routes.' },
  'bombardier-crj':  { hint: 'The Bombardier CRJ family (CRJ-200, 700, 900, 1000) serves short-haul regional routes across North America and Europe.' },
  'bombardier-dash-8': { hint: 'The Dash 8 (especially the Q400) is a fuel-efficient turboprop used by Porter, Flybe successors, and regional carriers on sub-1-hour hops.' },
  'atr-42-72':       { hint: 'The ATR 42/72 are Franco-Italian turboprops that dominate island-hopping, short regional, and sub-400nm markets worldwide.' },
};

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

  const copy = COPY[slug] || { hint: `The ${fam.label} is used on commercial routes worldwide. Explore every city pair it serves below.` };

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

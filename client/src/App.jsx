import { useState, useEffect, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import SearchForm from './components/SearchForm';
import FlightResults from './components/FlightResults';
import ExploreResults from './components/ExploreResults';
import ErrorBoundary from './components/ErrorBoundary';
import SkeletonResults from './components/SkeletonResults';
import AircraftSearchForm from './components/AircraftSearchForm';
// Map components pull Leaflet (~150KB gz) + their own code. Lazy-load them
// so the home page ships without the map runtime — users who never click
// "Route map" or "By aircraft" never download it.
const AircraftRouteMap = lazy(() => import('./components/AircraftRouteMap'));
const RouteMap         = lazy(() => import('./components/RouteMap'));
import { useFlightSearch } from './hooks/useFlightSearch';
import { useFilterOptions } from './hooks/useFilterOptions';
import { FilterOptionsContext } from './context/FilterOptionsContext';
import SiteLayout from './components/SiteLayout';
import { API_BASE } from './utils/api';
import './App.css';

function App() {
  const { filterOptions, error: filterOptionsError } = useFilterOptions();
  const [searchParams] = useSearchParams();

  // Parse on first render only
  const [initialMode] = useState(() => {
    const m = searchParams.get('mode');
    return ['search', 'by-aircraft', 'map'].includes(m) ? m : 'search';
  });
  const [initialFamily] = useState(() => searchParams.get('family') || null);
  const [initialFrom]   = useState(() => searchParams.get('from')   || null);
  const [initialTo]     = useState(() => searchParams.get('to')     || null);

  // Wrap setter to mirror state into URL via replaceState
  const [searchMode, setSearchModeState] = useState(initialMode);
  const setSearchMode = (next) => {
    setSearchModeState(next);
    const params = new URLSearchParams(window.location.search);
    if (next === 'search') {
      params.delete('mode');
    } else {
      params.set('mode', next);
    }
    // Drop family/from/to when switching modes — they're stale
    params.delete('family');
    params.delete('from');
    params.delete('to');
    const qs = params.toString();
    window.history.replaceState({}, '', qs ? `/?${qs}` : '/');
  };

  const [prefillDeparture, setPrefillDeparture] = useState(
    initialFrom ? { code: initialFrom, autoSearch: Boolean(initialFrom && initialTo) } : null
  );
  const [prefillArrival, setPrefillArrival] = useState(
    initialTo ? { code: initialTo, autoSearch: Boolean(initialFrom && initialTo) } : null
  );
  const [acQuery, setAcQuery] = useState(null); // { familyName, origin, date, passengers }
  // Email verification via URL: ?action=verify&token=...
  const [verifyState, setVerifyState] = useState(null); // null | 'pending' | 'success' | 'error'
  const [verifyMessage, setVerifyMessage] = useState('');

  const {
    flights,
    exploreResults,
    exploreContext,
    loading,
    loadingMessage,
    error,
    apiSource,
    hasSearched,
    searchedAirlines,
    handleSearch,
    handleExplore,
    clearError,
  } = useFlightSearch(filterOptions);

  // "By aircraft" is a map-as-output flow: user picks family + origin + date
  // and we render AircraftRouteMap showing every route that family has flown
  // from that origin in the last 14 days. Clicking a destination on the map
  // kicks off the actual priced search inside AircraftRouteMap.
  const handleAircraftSearch = (params) => {
    setAcQuery({
      familyName: params.familyName,
      origin:     params.departure,
      date:       params.date || null,
      passengers: params.passengers || 1,
      directOnly: Boolean(params.directOnly),
    });
  };

  // Handle email verification link: ?action=verify&token=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') !== 'verify') return;
    const token = params.get('token');
    if (!token) return;

    setVerifyState('pending');
    // Clean up URL immediately so user doesn't re-trigger on refresh
    window.history.replaceState({}, '', '/');

    fetch(`${API_BASE}/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(data => {
        setVerifyState(data.success ? 'success' : 'error');
        setVerifyMessage(data.message || (data.success ? 'Email verified!' : 'Verification failed.'));
      })
      .catch(() => {
        setVerifyState('error');
        setVerifyMessage('Verification failed. Please try again.');
      });
  }, []);

  const handleSelectDestination = (destinationCode) => {
    setPrefillArrival({ code: destinationCode, autoSearch: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <FilterOptionsContext.Provider value={filterOptions}>
      <SiteLayout variant="transparent-over-hero">
        <section className="hero">
          {verifyState && verifyState !== 'pending' && (
            <div
              className={`verify-banner verify-banner--${verifyState}`}
              role="alert"
            >
              <span>{verifyMessage}</span>
              {verifyState === 'success' && (
                <span className="verify-banner-hint">Use the Sign in button above.</span>
              )}
              <button
                className="error-dismiss"
                onClick={() => setVerifyState(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          <div className="hero-content">
            <h1 className="hero-title">Find flights by aircraft type</h1>
            <p className="hero-subtitle">Search routes worldwide, filtered by aircraft model</p>
          </div>

          {filterOptionsError && (
            <div className="error-banner" role="alert">
              <span>Failed to load search options. Please refresh the page.</span>
            </div>
          )}

          {filterOptions && (
            <div className="hero-search">
              <div className="search-mode-tabs">
                <button
                  className={`search-mode-tab${searchMode === 'search' ? ' search-mode-tab--active' : ''}`}
                  onClick={() => { setSearchMode('search'); setAcQuery(null); }}
                >
                  Search flights
                </button>
                <button
                  className={`search-mode-tab${searchMode === 'by-aircraft' ? ' search-mode-tab--active' : ''}`}
                  onClick={() => { setSearchMode('by-aircraft'); setAcQuery(null); }}
                >
                  By aircraft
                </button>
                <button
                  className={`search-mode-tab${searchMode === 'map' ? ' search-mode-tab--active' : ''}`}
                  onClick={() => { setSearchMode('map'); setAcQuery(null); }}
                >
                  Route map
                </button>
              </div>

              {searchMode === 'search' && (
                <SearchForm
                  onSearch={handleSearch}
                  onExplore={handleExplore}
                  loading={loading}
                  prefillDeparture={prefillDeparture}
                  prefillArrival={prefillArrival}
                  onPrefillUsed={() => { setPrefillDeparture(null); setPrefillArrival(null); }}
                />
              )}

              {searchMode === 'by-aircraft' && !acQuery && (
                <AircraftSearchForm
                  initialFamily={initialFamily}
                  onSearch={handleAircraftSearch}
                  loading={loading}
                  onCancel={clearError}
                />
              )}

              {searchMode === 'map' && (
                <p className="explore-hint" style={{ marginTop: 0 }}>
                  Explore global routes — click an airport to see destinations, draw a radius to find nearby airports.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="results-section">
          {searchMode === 'map' ? (
            <ErrorBoundary>
              <Suspense fallback={<SkeletonResults message="Loading map…" />}>
                <RouteMap />
              </Suspense>
            </ErrorBoundary>
          ) : searchMode === 'by-aircraft' && acQuery ? (
            <ErrorBoundary>
              <Suspense fallback={<SkeletonResults message="Loading map…" />}>
                <AircraftRouteMap
                  familyName={acQuery.familyName}
                  family={acQuery.familyName}
                  date={acQuery.date}
                  passengers={acQuery.passengers}
                  originIatas={[acQuery.origin]}
                  directOnly={acQuery.directOnly}
                  onBack={() => setAcQuery(null)}
                />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <>
              {error && (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                  <button className="error-dismiss" onClick={clearError} aria-label="Dismiss">×</button>
                </div>
              )}

              {loading && <SkeletonResults message={loadingMessage} />}

              {!loading && searchMode === 'search' && exploreResults !== null && (
                <ErrorBoundary>
                  <ExploreResults
                    results={exploreResults}
                    departure={exploreContext?.departure}
                    aircraft={exploreContext?.aircraft}
                    onSelect={handleSelectDestination}
                  />
                </ErrorBoundary>
              )}

              {!loading && (searchMode !== 'search' || exploreResults === null) && (
                <ErrorBoundary>
                  <FlightResults flights={flights} source={apiSource} hasSearched={hasSearched} initialAirlines={searchedAirlines} />
                </ErrorBoundary>
              )}
            </>
          )}
        </section>
      </SiteLayout>
    </FilterOptionsContext.Provider>
  );
}

export default App;

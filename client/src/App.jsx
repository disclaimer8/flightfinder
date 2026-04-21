import { useState, useEffect, lazy, Suspense } from 'react';
import SearchForm from './components/SearchForm';
import FlightResults from './components/FlightResults';
import ExploreResults from './components/ExploreResults';
import APIStatus from './components/APIStatus';
import ErrorBoundary from './components/ErrorBoundary';
import SkeletonResults from './components/SkeletonResults';
import AuthModal from './components/AuthModal';
import AircraftSearchForm from './components/AircraftSearchForm';
// Map components pull Leaflet (~150KB gz) + their own code. Lazy-load them
// so the home page ships without the map runtime — users who never click
// "Route map" or "By aircraft" never download it.
const AircraftRouteMap = lazy(() => import('./components/AircraftRouteMap'));
const RouteMap         = lazy(() => import('./components/RouteMap'));
import { useFlightSearch } from './hooks/useFlightSearch';
import { FilterOptionsContext } from './context/FilterOptionsContext';
import { useAuth } from './context/AuthContext';
import { API_BASE } from './utils/api';
import './App.css';

function App() {
  const { user, logout } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState('login');
  const [filterOptions, setFilterOptions] = useState(null);
  const [filterOptionsError, setFilterOptionsError] = useState(false);
  const [apiStatus, setApiStatus] = useState(null);
  const [prefillArrival, setPrefillArrival] = useState(null);
  const [searchMode, setSearchMode] = useState('search'); // 'search' | 'by-aircraft' | 'map'
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

    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
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

  useEffect(() => {
    fetch(`${API_BASE}/api/flights/filter-options`)
      .then(res => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then(data => {
        setFilterOptions(data);
        if (data.apiStatus) setApiStatus(data.apiStatus);
      })
      .catch(() => setFilterOptionsError(true));
  }, []);

  const handleSelectDestination = (destinationCode) => {
    setPrefillArrival({ code: destinationCode, autoSearch: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <FilterOptionsContext.Provider value={filterOptions}>
      <div className="app">
        <section className="hero">
          <nav className="nav">
            <div className="nav-brand">
              <span className="brand-icon" aria-hidden="true">✈</span>
              <span className="brand-name">FlightFinder</span>
            </div>
            <div className="nav-right">
              {apiStatus && <APIStatus status={apiStatus} />}
              {user ? (
                <div className="nav-user">
                  <span className="nav-user-email" title={user.email}>{user.email}</span>
                  <button className="nav-btn nav-btn-ghost" onClick={logout}>
                    Sign out
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className="nav-btn nav-btn-ghost"
                    onClick={() => { setAuthModalTab('login'); setAuthModalOpen(true); }}
                  >
                    Sign in
                  </button>
                  <button
                    className="nav-btn nav-btn-primary"
                    onClick={() => { setAuthModalTab('register'); setAuthModalOpen(true); }}
                  >
                    Sign up
                  </button>
                </>
              )}
            </div>
          </nav>
          {authModalOpen && (
            <AuthModal onClose={() => setAuthModalOpen(false)} initialTab={authModalTab} />
          )}

          {verifyState && verifyState !== 'pending' && (
            <div
              className={`verify-banner verify-banner--${verifyState}`}
              role="alert"
            >
              <span>{verifyMessage}</span>
              {verifyState === 'success' && (
                <button
                  className="nav-btn nav-btn-primary verify-banner-cta"
                  onClick={() => { setVerifyState(null); setAuthModalOpen(true); }}
                >
                  Sign in
                </button>
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
                  prefillArrival={prefillArrival}
                  onPrefillUsed={() => setPrefillArrival(null)}
                />
              )}

              {searchMode === 'by-aircraft' && !acQuery && (
                <AircraftSearchForm
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

        <main className="results-section">
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
        </main>
      </div>
    </FilterOptionsContext.Provider>
  );
}

export default App;

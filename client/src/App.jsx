import { useState, useEffect } from 'react';
import SearchForm from './components/SearchForm';
import FlightResults from './components/FlightResults';
import ExploreResults from './components/ExploreResults';
import APIStatus from './components/APIStatus';
import ErrorBoundary from './components/ErrorBoundary';
import SkeletonResults from './components/SkeletonResults';
import AuthModal from './components/AuthModal';
import AircraftSearchForm from './components/AircraftSearchForm';
import AircraftSearchResults from './components/AircraftSearchResults';
import AircraftRouteMap from './components/AircraftRouteMap';
import RouteMap from './components/RouteMap';
import { useFlightSearch } from './hooks/useFlightSearch';
import { useAircraftSearch } from './hooks/useAircraftSearch';
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
  const [acFamilyName, setAcFamilyName] = useState('');
  // Phase 3 — "by aircraft" has two sub-views: 'form' → 'map'
  const [acView, setAcView] = useState('form'); // 'form' | 'map'
  const [acMapProps, setAcMapProps] = useState(null); // { familyName, date, passengers, originIatas }
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

  const {
    results: acResults,
    progress: acProgress,
    pct: acPct,
    status: acStatus,
    error: acError,
    search: acSearch,
    cancel: acCancel,
  } = useAircraftSearch();

  const handleAircraftSearch = async (params) => {
    setAcFamilyName(params.familyName);

    // Phase 3: resolve origins to a concrete IATA set and switch to map view.
    // The form emits either { iata, radius? } OR { city, radius } OR neither.
    let originIatas = [];
    try {
      if (params.iata && params.radius) {
        // Exact origin + radius → fan out via /api/map/radius.
        const airportRes = await fetch(`/api/aircraft/airports/search?q=${encodeURIComponent(params.iata)}&limit=1`);
        const airportJson = await airportRes.json();
        const anchor = airportJson?.airports?.[0];
        if (anchor?.lat != null && anchor?.lon != null) {
          const near = await fetch(`/api/map/radius?lat=${anchor.lat}&lon=${anchor.lon}&radius=${params.radius}`)
            .then(r => r.json())
            .catch(() => null);
          originIatas = (near?.airports || []).map(a => a.iata).filter(Boolean);
        }
        if (!originIatas.length) originIatas = [params.iata];
      } else if (params.iata) {
        originIatas = [params.iata];
      } else if (params.city && params.radius) {
        // Free-text city — resolve to airport coords, then fan out.
        const searchRes = await fetch(`/api/aircraft/airports/search?q=${encodeURIComponent(params.city)}&limit=1`);
        const searchJson = await searchRes.json();
        const anchor = searchJson?.airports?.[0];
        if (anchor?.lat != null && anchor?.lon != null) {
          const near = await fetch(`/api/map/radius?lat=${anchor.lat}&lon=${anchor.lon}&radius=${params.radius}`)
            .then(r => r.json())
            .catch(() => null);
          originIatas = (near?.airports || []).map(a => a.iata).filter(Boolean);
          if (!originIatas.length && anchor.iata) originIatas = [anchor.iata];
        }
      }
    } catch (err) {
      console.warn('[App] origin resolution failed:', err);
    }

    if (!originIatas.length) {
      // No origins resolved — fall back to the classic streaming results view.
      setAcView('form');
      acSearch(params);
      return;
    }

    setAcMapProps({
      familyName: params.familyName,
      family: params.familyName, // backend currently keys off familyName
      date: params.date,
      passengers: params.passengers,
      originIatas,
    });
    setAcView('map');
  };

  // Empty-state "Try this hub" chip dispatches a window event — swap origins.
  useEffect(() => {
    const handler = (e) => {
      const iata = e.detail?.iata;
      if (!iata || !acMapProps) return;
      setAcMapProps({ ...acMapProps, originIatas: [iata] });
    };
    window.addEventListener('arm-swap-origin', handler);
    return () => window.removeEventListener('arm-swap-origin', handler);
  }, [acMapProps]);

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
                  onClick={() => setSearchMode('search')}
                >
                  Search flights
                </button>
                <button
                  className={`search-mode-tab${searchMode === 'by-aircraft' ? ' search-mode-tab--active' : ''}`}
                  onClick={() => setSearchMode('by-aircraft')}
                >
                  By aircraft
                </button>
                <button
                  className={`search-mode-tab${searchMode === 'map' ? ' search-mode-tab--active' : ''}`}
                  onClick={() => setSearchMode('map')}
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

              {searchMode === 'by-aircraft' && acView === 'form' && (
                <AircraftSearchForm
                  onSearch={handleAircraftSearch}
                  loading={acStatus === 'searching'}
                  onCancel={acCancel}
                />
              )}

              {searchMode === 'by-aircraft' && acView === 'map' && acMapProps && (
                <p className="explore-hint" style={{ marginTop: 0 }}>
                  Showing recent <strong>{acMapProps.familyName}</strong> routes from {acMapProps.originIatas.length} airport{acMapProps.originIatas.length === 1 ? '' : 's'}.
                </p>
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
              <RouteMap />
            </ErrorBoundary>
          ) : searchMode === 'by-aircraft' ? (
            <ErrorBoundary>
              {acView === 'map' && acMapProps ? (
                <AircraftRouteMap
                  familyName={acMapProps.familyName}
                  family={acMapProps.family}
                  date={acMapProps.date}
                  passengers={acMapProps.passengers}
                  originIatas={acMapProps.originIatas}
                  onBack={() => { setAcView('form'); setAcMapProps(null); }}
                />
              ) : (
                <AircraftSearchResults
                  results={acResults}
                  progress={acProgress}
                  pct={acPct}
                  status={acStatus}
                  error={acError}
                  familyName={acFamilyName}
                />
              )}
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

              {!loading && exploreResults !== null && (
                <ErrorBoundary>
                  <ExploreResults
                    results={exploreResults}
                    departure={exploreContext?.departure}
                    aircraft={exploreContext?.aircraft}
                    onSelect={handleSelectDestination}
                  />
                </ErrorBoundary>
              )}

              {!loading && exploreResults === null && (
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

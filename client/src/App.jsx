import { useState, useEffect } from 'react';
import SearchForm from './components/SearchForm';
import FlightResults from './components/FlightResults';
import ExploreResults from './components/ExploreResults';
import APIStatus from './components/APIStatus';
import ErrorBoundary from './components/ErrorBoundary';
import SkeletonResults from './components/SkeletonResults';
import AuthModal from './components/AuthModal';
import { useFlightSearch } from './hooks/useFlightSearch';
import { FilterOptionsContext } from './context/FilterOptionsContext';
import { useAuth } from './context/AuthContext';
import './App.css';

function App() {
  const { user, logout } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [filterOptions, setFilterOptions] = useState(null);
  const [filterOptionsError, setFilterOptionsError] = useState(false);
  const [apiStatus, setApiStatus] = useState(null);
  const [prefillArrival, setPrefillArrival] = useState(null);

  const {
    flights,
    exploreResults,
    exploreContext,
    loading,
    loadingMessage,
    error,
    apiSource,
    hasSearched,
    handleSearch,
    handleExplore,
    clearError,
  } = useFlightSearch(filterOptions);

  useEffect(() => {
    fetch('/api/flights/filter-options')
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
                <button
                  className="nav-btn nav-btn-primary"
                  onClick={() => setAuthModalOpen(true)}
                >
                  Sign in
                </button>
              )}
            </div>
          </nav>
          {authModalOpen && (
            <AuthModal onClose={() => setAuthModalOpen(false)} />
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
              <SearchForm
                onSearch={handleSearch}
                onExplore={handleExplore}
                loading={loading}
                prefillArrival={prefillArrival}
                onPrefillUsed={() => setPrefillArrival(null)}
              />
            </div>
          )}
        </section>

        <main className="results-section">
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
              <FlightResults flights={flights} source={apiSource} hasSearched={hasSearched} />
            </ErrorBoundary>
          )}
        </main>
      </div>
    </FilterOptionsContext.Provider>
  );
}

export default App;

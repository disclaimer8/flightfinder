import { useEffect, useState } from 'react';
import LegacyRedirect from '../components/LegacyRedirect';
import HomeSearchBar from '../components/HomeSearchBar';
import AircraftBrowser from '../components/AircraftBrowser';
import RecentSafetyEvents from '../components/RecentSafetyEvents';
import SiteLayout from '../components/SiteLayout';
import { useFilterOptions } from '../hooks/useFilterOptions';
import { FilterOptionsContext } from '../context/FilterOptionsContext';
import { API_BASE } from '../utils/api';
import '../App.css';

export default function Home() {
  const { filterOptions, error: filterOptionsError } = useFilterOptions();
  const [verifyState, setVerifyState] = useState(null);
  const [verifyMessage, setVerifyMessage] = useState('');

  // Email verification (?action=verify&token=…). One-shot: clean URL,
  // hit /api/auth/verify-email, render a banner. No other Home behavior
  // depends on this.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') !== 'verify') return;
    const token = params.get('token');
    if (!token) return;

    setVerifyState('pending');
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

  return (
    <FilterOptionsContext.Provider value={filterOptions}>
      <div data-testid="page-home">
        <LegacyRedirect />
        <SiteLayout variant="transparent-over-hero">
          <section className="hero">
            {filterOptionsError && (
              <div className="error-banner" role="alert">
                <span>Failed to load search options. Please refresh the page.</span>
              </div>
            )}

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
                >×</button>
              </div>
            )}

            <div className="hero-content">
              <h1 className="hero-title">
                The aircraft- and safety-aware flight search engine
              </h1>
              <p className="hero-subtitle">
                See which airline, which aircraft, and what its safety record looks like — before you book.
              </p>
              <HomeSearchBar />
            </div>
          </section>

          <AircraftBrowser />

          <RecentSafetyEvents />
        </SiteLayout>
      </div>
    </FilterOptionsContext.Provider>
  );
}

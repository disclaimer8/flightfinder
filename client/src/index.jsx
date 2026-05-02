import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import './index.css';

const AircraftLandingPage = lazy(() => import('./components/AircraftLandingPage'));
const RouteLandingPage    = lazy(() => import('./components/RouteLandingPage'));
const MyTrips = lazy(() => import('./pages/MyTrips'));
const Pricing = lazy(() => import('./pages/Pricing'));
const SubscribeReturn = lazy(() => import('./pages/SubscribeReturn'));
const Terms = lazy(() => import('./pages/legal/Terms'));
const Privacy = lazy(() => import('./pages/legal/Privacy'));
const Attributions = lazy(() => import('./pages/legal/Attributions'));
const SafetyFeed        = lazy(() => import('./pages/safety/SafetyFeed'));
const SafetyEventDetail = lazy(() => import('./pages/safety/SafetyEventDetail'));

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/aircraft/:slug" element={<Suspense fallback={null}><AircraftLandingPage /></Suspense>} />
            <Route path="/routes/:pair" element={<Suspense fallback={null}><RouteLandingPage /></Suspense>} />
            <Route path="/trips" element={<Suspense fallback={null}><MyTrips /></Suspense>} />
            <Route path="/pricing" element={<Suspense fallback={null}><Pricing /></Suspense>} />
            <Route path="/subscribe/return" element={<Suspense fallback={null}><SubscribeReturn /></Suspense>} />
            <Route path="/legal/terms" element={<Suspense fallback={null}><Terms /></Suspense>} />
            <Route path="/legal/privacy" element={<Suspense fallback={null}><Privacy /></Suspense>} />
            <Route path="/legal/attributions" element={<Suspense fallback={null}><Attributions /></Suspense>} />
            <Route path="/safety/feed"        element={<Suspense fallback={null}><SafetyFeed /></Suspense>} />
            <Route path="/safety/events/:id"  element={<Suspense fallback={null}><SafetyEventDetail /></Suspense>} />
            <Route path="*" element={<App />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Sentry init runs after first paint — saves ~14KB brotli + ~300-800ms of
// main-thread parse on the critical path. We accept that errors thrown in
// the very first idle window (typically <100ms) won't be captured; for an
// app with no live users yet (project_no_users_yet) the trade-off is
// straightforwardly worth it. Once Sentry initialises it instruments
// fetch/XHR globally, so subsequent network errors are still captured.
const initSentry = () => import('./sentry');
if (typeof window.requestIdleCallback === 'function') {
  window.requestIdleCallback(initSentry, { timeout: 2000 });
} else {
  setTimeout(initSentry, 0);
}

import './sentry'; // Must run before any other imports so Sentry can instrument fetch/XHR.
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import AircraftLandingPage from './components/AircraftLandingPage';
import RouteLandingPage from './components/RouteLandingPage';
import { AuthProvider } from './context/AuthContext';
import './index.css';

const MyTrips = lazy(() => import('./pages/MyTrips'));
const Pricing = lazy(() => import('./pages/Pricing'));
const SubscribeReturn = lazy(() => import('./pages/SubscribeReturn'));
const Terms = lazy(() => import('./pages/legal/Terms'));
const Privacy = lazy(() => import('./pages/legal/Privacy'));
const SafetyFeed        = lazy(() => import('./pages/safety/SafetyFeed'));
const SafetyEventDetail = lazy(() => import('./pages/safety/SafetyEventDetail'));

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/aircraft/:slug" element={<AircraftLandingPage />} />
            <Route path="/routes/:pair" element={<RouteLandingPage />} />
            <Route path="/trips" element={<Suspense fallback={null}><MyTrips /></Suspense>} />
            <Route path="/pricing" element={<Suspense fallback={null}><Pricing /></Suspense>} />
            <Route path="/subscribe/return" element={<Suspense fallback={null}><SubscribeReturn /></Suspense>} />
            <Route path="/legal/terms" element={<Suspense fallback={null}><Terms /></Suspense>} />
            <Route path="/legal/privacy" element={<Suspense fallback={null}><Privacy /></Suspense>} />
            <Route path="/safety/feed"        element={<Suspense fallback={null}><SafetyFeed /></Suspense>} />
            <Route path="/safety/events/:id"  element={<Suspense fallback={null}><SafetyEventDetail /></Suspense>} />
            <Route path="*" element={<App />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

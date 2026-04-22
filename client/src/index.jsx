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
            <Route path="*" element={<App />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

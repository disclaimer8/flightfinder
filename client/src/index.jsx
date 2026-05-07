import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import AppRoutes from './AppRoutes';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Thin error reporter — replaces @sentry/react which weighed 124KB brotli.
// Init is deferred to idle so we never block first paint. The reporter
// itself is <1KB (see errorReporter.js); no SDK chunk to download.
import('./errorReporter').then(m => m.initErrorReporter());

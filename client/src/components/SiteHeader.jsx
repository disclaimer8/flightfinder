import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFilterOptions } from '../hooks/useFilterOptions';
import { isNativeApp } from '../utils/platform';
import APIStatus from './APIStatus';
import './SiteHeader.css';

function isActive(pathname, search, target) {
  if (target.path === '/by-aircraft') {
    if (pathname === '/by-aircraft') return true;
    if (pathname.startsWith('/aircraft/')) return true;
    if (pathname === '/' && search.get('mode') === 'by-aircraft') return true;
    return false;
  }
  if (target.path === '/safety/global') {
    return pathname.startsWith('/safety/');
  }
  if (target.path === '/?mode=search') {
    if (pathname !== '/') return false;
    const m = search.get('mode');
    return m === null || m === 'search';
  }
  return pathname === target.path;
}

export default function SiteHeader({ variant, scrolled, onSignInClick, onSignUpClick }) {
  const { user, logout } = useAuth();
  const { apiStatus } = useFilterOptions();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef(null);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname, location.search]);

  // ESC closes drawer
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = e => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const navItems = [
    { path: '/?mode=search',  label: 'Search' },
    { path: '/by-aircraft',   label: 'By aircraft' },
    { path: '/safety/global', label: 'Safety' },
  ];
  if (!isNativeApp()) navItems.push({ path: '/pricing', label: 'Pricing' });

  return (
    <header
      className="site-header"
      data-testid="site-header"
      data-variant={variant ?? 'default'}
      data-scrolled={scrolled ? 'true' : 'false'}
    >
      <div className="site-header-inner">
        <Link to="/" className="site-header-brand" aria-label="FlightFinder home">
          <svg className="site-header-icon" viewBox="0 0 512 512" aria-hidden="true">
            <defs>
              <linearGradient id="ff-brand-bg-h" x1="86" y1="21" x2="426" y2="491" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#3B8BFF" />
                <stop offset="100%" stopColor="#0A42B5" />
              </linearGradient>
            </defs>
            <circle cx="256" cy="256" r="240" fill="url(#ff-brand-bg-h)" />
            <g transform="translate(256,256) rotate(35) scale(2.0) translate(-100,-99)" fill="white">
              <ellipse cx="100" cy="99" rx="9" ry="88" />
              <path d="M91 76 C80 80, 42 94, 10 114 C7 118, 8 123, 12 124 C17 122, 42 106, 91 100 Z" />
              <path d="M109 76 C120 80, 158 94, 190 114 C193 118, 192 123, 188 124 C183 122, 158 106, 109 100 Z" />
            </g>
          </svg>
          <span className="site-header-wordmark">FlightFinder</span>
        </Link>

        <nav className="site-header-nav" aria-label="Primary">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`site-header-link${isActive(location.pathname, searchParams, item) ? ' site-header-link--active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="site-header-actions">
          {apiStatus && <APIStatus status={apiStatus} />}
          {user ? (
            <>
              <Link to="/trips" className="site-header-action">My Trips</Link>
              <span className="site-header-email" title={user.email}>{user.email}</span>
              <button className="site-header-action" onClick={logout}>Sign out</button>
            </>
          ) : (
            <>
              <button className="site-header-action" onClick={onSignInClick}>Sign in</button>
              <button className="site-header-action site-header-action--primary" onClick={onSignUpClick}>Sign up</button>
            </>
          )}
        </div>

        <button
          className="site-header-burger"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <span /><span /><span />
        </button>
      </div>

      {drawerOpen && (
        <div
          className="site-header-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          ref={drawerRef}
        >
          <div className="site-header-drawer-head">
            <span className="site-header-wordmark">FlightFinder</span>
            <button
              className="site-header-drawer-close"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
            >×</button>
          </div>
          <nav className="site-header-drawer-nav" aria-label="Mobile">
            {navItems.map(item => (
              <Link key={item.path} to={item.path}>{item.label}</Link>
            ))}
            {user ? (
              <>
                <Link to="/trips">My Trips</Link>
                <button onClick={logout}>Sign out</button>
              </>
            ) : (
              <>
                <button onClick={() => { setDrawerOpen(false); onSignInClick(); }}>Sign in</button>
                <button onClick={() => { setDrawerOpen(false); onSignUpClick(); }}>Sign up</button>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

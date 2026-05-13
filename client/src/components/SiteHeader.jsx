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
  if (target.path === '/search') {
    if (pathname === '/search') return true;
    if (pathname === '/' && search.get('mode') === 'search') return true;
    return false;
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
    { path: '/search',        label: 'Search' },
    { path: '/by-aircraft',   label: 'By aircraft' },
    { path: '/map',           label: 'Map' },
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
        <Link to="/" className="site-header-brand" aria-label="Flight Finder home">
          <span className="site-header-wordmark">Flight</span>
          <span className="site-header-wordmark--soft">Finder</span>
        </Link>

        <nav className="site-header-nav" aria-label="Primary">
          {navItems.map(item => {
            const active = isActive(location.pathname, searchParams, item);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={active ? 'page' : undefined}
                className={`site-header-link${active ? ' site-header-link--active' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
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
            <span className="site-header-brand">
              <span className="site-header-wordmark">Flight</span>
              <span className="site-header-wordmark--soft">Finder</span>
            </span>
            <button
              className="site-header-drawer-close"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
            >×</button>
          </div>
          <nav className="site-header-drawer-nav" aria-label="Mobile">
            {navItems.map(item => {
              const active = isActive(location.pathname, searchParams, item);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
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

import { useState, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import AuthModal from './AuthModal';
import { isNativeApp } from '../utils/platform';
import './SiteLayout.css';

export default function SiteLayout({ variant = 'default', children }) {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab]   = useState('login');
  const [overHero, setOverHero] = useState(variant === 'transparent-over-hero');
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (variant !== 'transparent-over-hero') return;
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => setOverHero(entry.isIntersecting),
      { rootMargin: '-64px 0px 0px 0px' }
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [variant]);

  if (isNativeApp()) {
    return <>{children ?? <Outlet />}</>;
  }

  return (
    <div className={`site-layout site-layout--${variant}`} data-over-hero={overHero}>
      <SiteHeader
        variant={variant}
        scrolled={!overHero}
        onSignInClick={() => { setAuthModalTab('login'); setAuthModalOpen(true); }}
        onSignUpClick={() => { setAuthModalTab('register'); setAuthModalOpen(true); }}
      />
      <main className="site-layout-main">
        {children ?? <Outlet />}
      </main>
      {variant === 'transparent-over-hero' && (
        <div ref={sentinelRef} className="site-layout-sentinel" aria-hidden="true" />
      )}
      <SiteFooter />
      {authModalOpen && (
        <AuthModal initialTab={authModalTab} onClose={() => setAuthModalOpen(false)} />
      )}
    </div>
  );
}

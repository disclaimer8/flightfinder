import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Store access token in a ref — never in localStorage
  const tokenRef = useRef(null);

  const refreshUser = useCallback(async () => {
    if (!tokenRef.current) { setUser(null); return null; }
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) { tokenRef.current = null; setUser(null); return null; }
      const data = await res.json();
      const next = data.user ?? data;
      setUser(next);
      return next;
    } catch {
      tokenRef.current = null;
      setUser(null);
      return null;
    }
  }, []);

  const getToken = useCallback(() => tokenRef.current, []);

  // Restore session on mount. Access token lives only in memory (security), so
  // on full page reload it's gone — but the httpOnly refreshToken cookie
  // survives. /api/auth/refresh trades that cookie for a fresh access token,
  // then we hydrate the user via /me. The cookie is httpOnly so JS can't see
  // it directly — instead we set a localStorage hint on successful login and
  // skip the refresh probe entirely for users who've never authenticated.
  // This avoids spamming /auth/refresh with 401s for anonymous visitors.
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.localStorage.getItem('hadAuth')) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.accessToken) {
            tokenRef.current = data.accessToken;
            await refreshUser();
          }
        } else {
          // Stale hint — cookie expired/revoked. Clear so future visits skip the probe.
          try { window.localStorage.removeItem('hadAuth'); } catch {}
        }
      } catch {
        // Network hiccup — stay unauthenticated, user can sign in manually.
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshUser]);

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include', // so the httpOnly refresh cookie is set
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Login failed');
    }
    tokenRef.current = data.accessToken;
    try { window.localStorage.setItem('hadAuth', '1'); } catch {}
    // Hydrate full user (subscription_tier, sub_valid_until, ...) via /auth/me.
    await refreshUser();
    return data;
  }, [refreshUser]);

  const register = useCallback(async (email, password) => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Registration failed');
    }
    // Don't auto-login — user must verify email first
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network errors on logout
    }
    tokenRef.current = null;
    try { window.localStorage.removeItem('hadAuth'); } catch {}
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

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

  // Restore session on mount by calling /api/auth/me with any stored token
  useEffect(() => {
    (async () => {
      if (tokenRef.current) await refreshUser();
      setLoading(false);
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

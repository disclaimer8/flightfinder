import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Store access token in a ref — never in localStorage
  const tokenRef = useRef(null);

  // Restore session on mount by calling /api/auth/me with any stored token
  useEffect(() => {
    const restore = async () => {
      if (!tokenRef.current) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${tokenRef.current}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user ?? data);
        } else {
          tokenRef.current = null;
        }
      } catch {
        tokenRef.current = null;
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

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
    setUser({ email });
    return data;
  }, []);

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
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

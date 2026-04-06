import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../utils/api';
import './AuthModal.css';

// Eye / EyeOff icons (inline SVG — no extra dependency needed)
function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

// Basic email format check
function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function AuthModal({ onClose, initialTab = 'login' }) {
  const { login, register } = useAuth();

  const [tab, setTab] = useState(initialTab); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [resendStatus, setResendStatus] = useState(''); // '' | 'sending' | 'sent'

  // Field-level validation (only shown after first submit attempt)
  const [touched, setTouched] = useState({ email: false, password: false });

  const modalRef = useRef(null);
  const firstFocusRef = useRef(null);
  const closeRef = useRef(null);

  // Focus trap
  useEffect(() => {
    // Focus first interactive element after mount
    firstFocusRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const modal = modalRef.current;
      if (!modal) return;

      const focusable = modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const switchTab = useCallback((next) => {
    setTab(next);
    setEmail('');
    setPassword('');
    setShowPw(false);
    setError('');
    setTouched({ email: false, password: false });
    setVerificationSent(false);
    setResendStatus('');
    // Re-focus email input after tab switch
    setTimeout(() => firstFocusRef.current?.focus(), 50);
  }, []);

  const handleResend = async () => {
    setResendStatus('sending');
    try {
      await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // ignore — server always returns success to prevent enumeration
    }
    setResendStatus('sent');
  };

  const emailError = touched.email && !isValidEmail(email) ? 'Enter a valid email address' : '';
  const passwordError = touched.password && password.length < 8
    ? 'Password must be at least 8 characters'
    : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched({ email: true, password: true });

    if (!isValidEmail(email) || password.length < 8) return;

    setSubmitting(true);
    setError('');

    try {
      if (tab === 'login') {
        await login(email, password);
        setSuccess(true);
        setTimeout(() => onClose(), 1000);
      } else {
        const data = await register(email, password);
        if (data.requiresVerification) {
          setVerificationSent(true);
        } else {
          setSuccess(true);
          setTimeout(() => onClose(), 1000);
        }
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="auth-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={tab === 'login' ? 'Sign in' : 'Create account'}
      onClick={handleBackdropClick}
    >
      <div className="auth-modal" ref={modalRef}>
        {/* ── Header ── */}
        <div className="auth-modal-header">
          <div className="auth-modal-brand">
            <span className="auth-modal-brand-icon" aria-hidden="true">✈</span>
            <span className="auth-modal-brand-name">FlightFinder</span>
          </div>

          <button
            ref={closeRef}
            className="auth-modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>

          <div className="auth-tabs" role="tablist" aria-label="Authentication tabs">
            <button
              role="tab"
              aria-selected={tab === 'login'}
              className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
              onClick={() => switchTab('login')}
              id="tab-login"
              aria-controls="panel-login"
            >
              Sign in
            </button>
            <button
              role="tab"
              aria-selected={tab === 'register'}
              className={`auth-tab ${tab === 'register' ? 'active' : ''}`}
              onClick={() => switchTab('register')}
              id="tab-register"
              aria-controls="panel-register"
            >
              Create account
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="auth-modal-body">
          {verificationSent ? (
            <div className="auth-verify-sent" role="status" aria-live="polite">
              <div className="auth-success-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <p className="auth-success-msg">Check your email</p>
              <p className="auth-verify-desc">
                We sent a confirmation link to <strong>{email}</strong>.<br />
                Click it to activate your account.
              </p>
              <p className="auth-verify-resend">
                {resendStatus === 'sent'
                  ? <span className="auth-verify-resent">Link sent again!</span>
                  : (
                    <button
                      type="button"
                      className="auth-link-btn"
                      onClick={handleResend}
                      disabled={resendStatus === 'sending'}
                    >
                      {resendStatus === 'sending' ? 'Sending…' : "Didn't get it? Resend"}
                    </button>
                  )
                }
              </p>
            </div>
          ) : success ? (
            <div className="auth-success" role="status" aria-live="polite">
              <div className="auth-success-icon">
                <CheckIcon />
              </div>
              <p className="auth-success-msg">
                {tab === 'login' ? 'Welcome back!' : 'Account created!'}
              </p>
            </div>
          ) : (
            <form
              id={tab === 'login' ? 'panel-login' : 'panel-register'}
              role="tabpanel"
              aria-labelledby={tab === 'login' ? 'tab-login' : 'tab-register'}
              className="auth-form"
              onSubmit={handleSubmit}
              noValidate
            >
              {/* Global error */}
              {error && (
                <div className="auth-error-banner" role="alert">
                  <AlertIcon />
                  <span>{error}</span>
                </div>
              )}

              {/* Email */}
              <div className="auth-field">
                <label htmlFor="auth-email">Email</label>
                <div className="auth-input-wrap">
                  <input
                    ref={firstFocusRef}
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(''); }}
                    onBlur={() => setTouched(t => ({ ...t, email: true }))}
                    aria-invalid={emailError ? 'true' : undefined}
                    aria-describedby={emailError ? 'auth-email-err' : undefined}
                    className={emailError ? 'input-error' : ''}
                    disabled={submitting}
                  />
                </div>
                {emailError && (
                  <span id="auth-email-err" className="auth-field-error" role="alert">
                    {emailError}
                  </span>
                )}
              </div>

              {/* Password */}
              <div className="auth-field">
                <label htmlFor="auth-password">Password</label>
                <div className="auth-input-wrap">
                  <input
                    id="auth-password"
                    type={showPw ? 'text' : 'password'}
                    data-pw="true"
                    autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                    placeholder={tab === 'register' ? 'Min. 8 characters' : '••••••••'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    onBlur={() => setTouched(t => ({ ...t, password: true }))}
                    aria-invalid={passwordError ? 'true' : undefined}
                    aria-describedby={passwordError ? 'auth-pw-err' : undefined}
                    className={passwordError ? 'input-error' : ''}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="auth-pw-toggle"
                    onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    tabIndex={0}
                    disabled={submitting}
                  >
                    {showPw ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {passwordError && (
                  <span id="auth-pw-err" className="auth-field-error" role="alert">
                    {passwordError}
                  </span>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="auth-submit"
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting && <span className="auth-btn-spinner" aria-hidden="true" />}
                {submitting
                  ? tab === 'login' ? 'Signing in…' : 'Creating account…'
                  : tab === 'login' ? 'Sign in' : 'Create account'}
              </button>

              {/* Footer switch */}
              <p className="auth-switch">
                {tab === 'login' ? (
                  <>
                    No account?{' '}
                    <button type="button" onClick={() => switchTab('register')}>
                      Create one
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button type="button" onClick={() => switchTab('login')}>
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

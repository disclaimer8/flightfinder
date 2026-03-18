import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthModal from '../AuthModal';
import { AuthProvider } from '../../context/AuthContext';

// Helper — wraps modal in AuthProvider so useAuth() resolves
function renderModal(props = {}) {
  const onClose = props.onClose ?? vi.fn();
  return render(
    <AuthProvider>
      <AuthModal onClose={onClose} {...props} />
    </AuthProvider>
  );
}

beforeEach(() => {
  // AuthProvider calls /api/auth/me only when there is a stored token.
  // On test mount tokenRef is null so no fetch happens automatically.
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Rendering ───────────────────────────────────────────────────────────────

describe('AuthModal rendering', () => {
  it('renders Sign in tab by default', () => {
    renderModal();
    expect(screen.getByRole('tab', { name: /sign in/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders Create account tab when initialTab="register"', () => {
    renderModal({ initialTab: 'register' });
    expect(screen.getByRole('tab', { name: /create account/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders email and password fields', () => {
    renderModal();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('renders FlightFinder brand inside modal', () => {
    renderModal();
    expect(screen.getByText('FlightFinder')).toBeInTheDocument();
  });

  it('has a close button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /close dialog/i })).toBeInTheDocument();
  });
});

// ─── Close behaviour ─────────────────────────────────────────────────────────

describe('AuthModal close behaviour', () => {
  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await userEvent.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    // The backdrop has role="dialog" and is the outermost element
    const backdrop = screen.getByRole('dialog');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─── Tab switching ────────────────────────────────────────────────────────────

describe('AuthModal tab switching', () => {
  it('switches to Create account tab on click', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('tab', { name: /create account/i }));
    expect(screen.getByRole('tab', { name: /create account/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /sign in/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('clears form fields when switching tabs', async () => {
    renderModal();
    const emailInput = screen.getByLabelText('Email');
    await userEvent.type(emailInput, 'test@example.com');
    await userEvent.click(screen.getByRole('tab', { name: /create account/i }));
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });
});

// ─── Password visibility toggle ──────────────────────────────────────────────

describe('AuthModal password toggle', () => {
  it('toggles password visibility', async () => {
    renderModal();
    const pwInput = screen.getByLabelText('Password');
    expect(pwInput).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(pwInput).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(pwInput).toHaveAttribute('type', 'password');
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe('AuthModal validation', () => {
  it('shows email error when invalid email is submitted', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText('Email'), 'notanemail');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
  });

  it('shows password length error when password is too short', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText('Email'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('does not call login when form is invalid', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── Submission ──────────────────────────────────────────────────────────────

describe('AuthModal submission', () => {
  it('shows loading state while submitting', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
    renderModal();
    await userEvent.type(screen.getByLabelText('Email'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/signing in/i)).toBeInTheDocument();
  });

  it('shows server error when login fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, message: 'Invalid credentials' }),
    }));
    renderModal();
    await userEvent.type(screen.getByLabelText('Email'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpassword');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('shows success state after successful login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, accessToken: 'tok123', expiresIn: 3600 }),
    }));
    renderModal();
    await userEvent.type(screen.getByLabelText('Email'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/welcome back/i)).toBeInTheDocument();
  });

  it('calls onClose after successful login (after success delay)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, accessToken: 'tok123', expiresIn: 3600 }),
    }));
    const onClose = vi.fn();
    renderModal({ onClose });
    await userEvent.type(screen.getByLabelText('Email'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    // Wait for success text to appear
    await screen.findByText(/welcome back/i);
    // Advance past the 1000ms delay
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

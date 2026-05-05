import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { AuthProvider } from '../context/AuthContext';
import { _resetForTests } from '../hooks/useFilterOptions';

const FILTER_OPTIONS = {
  cities: [
    { code: 'JFK', name: 'New York' },
    { code: 'LAX', name: 'Los Angeles' },
  ],
  aircraft: [{ code: '738', name: 'Boeing 737-800', type: 'jet' }],
  aircraftTypes: ['jet', 'turboprop'],
  apiStatus: null,
};

function mockFetch(response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

function okResponse(data) {
  return {
    ok: true,
    statusText: 'OK',
    json: () => Promise.resolve(data),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the useFilterOptions singleton so each test gets a fresh fetch
  _resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetForTests();
});

function renderApp() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('App', () => {
  it('mounts without crashing', async () => {
    mockFetch(okResponse(FILTER_OPTIONS));
    renderApp();
    // Hero title is always present
    expect(screen.getByText(/find flights by aircraft type/i)).toBeInTheDocument();
  });

  it('shows search form after filter-options load', async () => {
    mockFetch(okResponse(FILTER_OPTIONS));
    renderApp();
    // After filter-options load, the search mode tabs appear.
    // Use getAllByRole because there are two buttons matching "search flights":
    // the mode tab and the form submit button.
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /search flights/i });
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows error banner when filter-options request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    renderApp();
    await waitFor(() =>
      expect(screen.getByText(/failed to load search options/i)).toBeInTheDocument()
    );
  });

  it('shows Sign in button in nav when logged out', async () => {
    mockFetch(okResponse(FILTER_OPTIONS));
    renderApp();
    // Sign in button is now rendered by SiteHeader inside SiteLayout
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});

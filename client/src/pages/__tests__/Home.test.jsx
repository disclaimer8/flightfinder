import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import { _resetForTests } from '../../hooks/useFilterOptions';
import Home from '../Home';

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
  _resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetForTests();
});

function renderHome() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Home />
      </AuthProvider>
    </MemoryRouter>
  );
}

test('Home renders the hero H1 and search-mode tabs', async () => {
  mockFetch(okResponse(FILTER_OPTIONS));
  renderHome();
  expect(screen.getByRole('heading', { level: 1, name: /aircraft/i })).toBeInTheDocument();
  await waitFor(() => {
    // "Search flights" appears twice: mode tab + form submit button
    const searchFlightsBtns = screen.getAllByRole('button', { name: /Search flights/i });
    expect(searchFlightsBtns.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /By aircraft/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Route map/i })).toBeInTheDocument();
  });
});

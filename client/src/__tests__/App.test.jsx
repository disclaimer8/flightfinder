import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

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

function errorResponse() {
  return {
    ok: false,
    statusText: 'Internal Server Error',
    json: () => Promise.reject(new Error('parse error')),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('mounts without crashing', async () => {
    mockFetch(okResponse(FILTER_OPTIONS));
    render(<App />);
    // Hero title is always present
    expect(screen.getByText(/find flights by aircraft type/i)).toBeInTheDocument();
  });

  it('shows search form after filter-options load', async () => {
    mockFetch(okResponse(FILTER_OPTIONS));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /search flights/i })).toBeInTheDocument()
    );
  });

  it('shows error banner when filter-options request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/failed to load search options/i)).toBeInTheDocument()
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import App from '../App';

vi.mock('axios');

const FILTER_OPTIONS = {
  cities: [
    { code: 'JFK', name: 'New York' },
    { code: 'LAX', name: 'Los Angeles' },
  ],
  aircraft: [{ code: '738', name: 'Boeing 737-800', type: 'jet' }],
  aircraftTypes: ['jet', 'turboprop'],
  apiStatus: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('App', () => {
  it('mounts without crashing', async () => {
    axios.get.mockResolvedValueOnce({ data: FILTER_OPTIONS });
    render(<App />);
    // Hero title is always present
    expect(screen.getByText(/find flights by aircraft type/i)).toBeInTheDocument();
  });

  it('shows search form after filter-options load', async () => {
    axios.get.mockResolvedValueOnce({ data: FILTER_OPTIONS });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /search flights/i })).toBeInTheDocument()
    );
  });

  it('shows error banner when filter-options request fails', async () => {
    axios.get.mockRejectedValueOnce(new Error('Network error'));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/failed to load search options/i)).toBeInTheDocument()
    );
  });
});

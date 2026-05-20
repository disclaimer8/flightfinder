import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mock the route-brief fetch
const fetchBriefMock = vi.fn();
vi.mock('../mapApi', () => ({
  fetchRouteBrief: (...args) => fetchBriefMock(...args),
}));

import RoutePopup from '../RoutePopup';

beforeEach(() => {
  fetchBriefMock.mockReset();
});

describe('RoutePopup', () => {
  it('shows IATA pair immediately while brief is loading', () => {
    fetchBriefMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<RoutePopup dep="LHR" arr="JFK" onClose={() => {}} />);
    expect(screen.getByText(/LHR/)).toBeInTheDocument();
    expect(screen.getByText(/JFK/)).toBeInTheDocument();
  });

  it('renders block time and airlines list once brief resolves', async () => {
    fetchBriefMock.mockResolvedValueOnce({
      blockTimeMinutes: 480,
      airlines: [{ iata: 'BA', name: 'British Airways' }, { iata: 'AA', name: 'American Airlines' }],
      aircraft: [{ icao: 'A380', label: 'Airbus A380' }],
    });
    render(<RoutePopup dep="LHR" arr="JFK" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/British Airways/i)).toBeInTheDocument();
      expect(screen.getByText(/Airbus A380/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/8h 0m/i)).toBeInTheDocument(); // 480 minutes formatted
  });

  it('shows Search CTA linking to /search?from=&to=', () => {
    fetchBriefMock.mockResolvedValueOnce({});
    render(<RoutePopup dep="LHR" arr="JFK" onClose={() => {}} />);
    const cta = screen.getByRole('link', { name: /search flights/i });
    expect(cta).toHaveAttribute('href', '/search?from=LHR&to=JFK');
  });

  it('renders IATA pair and CTA even if brief fetch fails', async () => {
    fetchBriefMock.mockRejectedValueOnce(new Error('500'));
    render(<RoutePopup dep="LHR" arr="JFK" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/LHR/)).toBeInTheDocument();
      expect(screen.getByText(/JFK/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /search flights/i })).toBeInTheDocument();
    });
  });

  it('calls onClose when × clicked', () => {
    fetchBriefMock.mockResolvedValueOnce({});
    const onClose = vi.fn();
    render(<RoutePopup dep="LHR" arr="JFK" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AirportPanel from '../AirportPanel';

const AIRPORT = {
  iata: 'LHR',
  name: 'London Heathrow',
  city: 'London',
  country: 'United Kingdom',
  lat: 51.4, lon: -0.4,
};
const ROUTES = [
  { dep: { iata: 'LHR' }, arr: { iata: 'JFK' }, airline_count: 5, aircraft_count: 3, last_seen_at: 0 },
  { dep: { iata: 'LHR' }, arr: { iata: 'CDG' }, airline_count: 4, aircraft_count: 2, last_seen_at: 0 },
  { dep: { iata: 'LHR' }, arr: { iata: 'JFK' }, airline_count: 1, aircraft_count: 1, last_seen_at: 0 },
  { dep: { iata: 'DXB' }, arr: { iata: 'LHR' }, airline_count: 3, aircraft_count: 2, last_seen_at: 0 },
];

describe('AirportPanel', () => {
  it('renders airport name, city, country', () => {
    render(<AirportPanel airport={AIRPORT} routes={ROUTES} onClose={() => {}} />);
    expect(screen.getByText('London Heathrow')).toBeInTheDocument();
    expect(screen.getByText(/LHR · London, United Kingdom/)).toBeInTheDocument();
  });

  it('renders three stat tiles: destinations, airlines, aircraft', () => {
    render(<AirportPanel airport={AIRPORT} routes={ROUTES} onClose={() => {}} />);
    // 3 distinct destinations from LHR: JFK (2 routes — counts once), CDG, DXB
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/destinations/i)).toBeInTheDocument();
    expect(screen.getByText(/airlines/i)).toBeInTheDocument();
    expect(screen.getByText(/aircraft/i)).toBeInTheDocument();
  });

  it('renders top destinations list', () => {
    render(<AirportPanel airport={AIRPORT} routes={ROUTES} onClose={() => {}} />);
    // JFK appears 2 times → top
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0]).toHaveTextContent('JFK');
  });

  it('renders search CTA linking to /search?from=IATA', () => {
    render(<AirportPanel airport={AIRPORT} routes={ROUTES} onClose={() => {}} />);
    const cta = screen.getByRole('link', { name: /search flights from lhr/i });
    expect(cta).toHaveAttribute('href', '/search?from=LHR');
  });

  it('calls onClose when × button clicked', () => {
    const onClose = vi.fn();
    render(<AirportPanel airport={AIRPORT} routes={ROUTES} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape pressed', () => {
    const onClose = vi.fn();
    render(<AirportPanel airport={AIRPORT} routes={ROUTES} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('returns null when airport is null', () => {
    const { container } = render(<AirportPanel airport={null} routes={[]} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

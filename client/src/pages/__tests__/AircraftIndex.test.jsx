import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AircraftIndex from '../AircraftIndex';

const FIXTURE = [
  { slug: 'boeing-787',      label: 'Boeing 787 Dreamliner',     manufacturer: 'Boeing', category: 'wide-body',   tagline: 'Long-haul composite-bodied workhorse.' },
  { slug: 'airbus-a320',     label: 'Airbus A320 (all variants)',manufacturer: 'Airbus', category: 'narrow-body', tagline: 'Best-selling single-aisle.' },
  { slug: 'embraer-e190-e195', label: 'Embraer E190/E195',       manufacturer: 'Embraer',category: 'regional',    tagline: 'Regional jet workhorse.' },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation(url => {
    if (typeof url === 'string' && url.includes('aircraft-index.json')) {
      return Promise.resolve({ ok: true, json: async () => FIXTURE });
    }
    if (typeof url === 'string' && url.includes('/api/aircraft/index-stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ stats: {}, popular: [] }) });
    }
    return Promise.resolve({ ok: false });
  });
});

describe('AircraftIndex', () => {
  it('renders all aircraft tiles by default', async () => {
    render(<MemoryRouter><AircraftIndex /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Boeing 787 Dreamliner/)).toBeInTheDocument());
    expect(screen.getByText(/Airbus A320/)).toBeInTheDocument();
    expect(screen.getByText(/Embraer E190/)).toBeInTheDocument();
  });

  it('filters tiles by category', async () => {
    render(<MemoryRouter><AircraftIndex /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Boeing 787/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /wide-body/i }));
    expect(screen.getByText(/Boeing 787/)).toBeInTheDocument();
    expect(screen.queryByText(/Airbus A320/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Embraer E190/)).not.toBeInTheDocument();
  });

  it('tile links to /aircraft/:slug', async () => {
    render(<MemoryRouter><AircraftIndex /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Boeing 787/)).toBeInTheDocument());
    const link = screen.getByText(/Boeing 787/).closest('a');
    expect(link).toHaveAttribute('href', '/aircraft/boeing-787');
  });

  it('shows fallback when fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false });
    render(<MemoryRouter><AircraftIndex /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/couldn't load|failed/i)).toBeInTheDocument());
  });
});

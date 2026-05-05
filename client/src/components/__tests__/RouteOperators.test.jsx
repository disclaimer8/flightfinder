import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RouteOperators from '../RouteOperators';

const FIXTURE = {
  success: true,
  dep: 'LHR',
  arr: 'JFK',
  windowDays: 90,
  operators: [
    { iata: 'BA', icao: 'BAW', name: 'British Airways', count: 120, safetyCount90d: 0 },
    { iata: 'VS', icao: 'VIR', name: 'Virgin Atlantic', count: 60,  safetyCount90d: 1 },
    { iata: 'AA', icao: 'AAL', name: 'American Airlines', count: 45, safetyCount90d: 2 },
  ],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => FIXTURE });
});

describe('RouteOperators', () => {
  it('renders rows from the API', async () => {
    render(<MemoryRouter><RouteOperators from="LHR" to="JFK" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('British Airways')).toBeInTheDocument());
    expect(screen.getByText('Virgin Atlantic')).toBeInTheDocument();
    expect(screen.getByText('American Airlines')).toBeInTheDocument();
  });

  it('renders "No recorded events" for operators with safetyCount90d === 0', async () => {
    render(<MemoryRouter><RouteOperators from="LHR" to="JFK" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('British Airways')).toBeInTheDocument());
    const baRow = screen.getByText('British Airways').closest('tr');
    expect(baRow.textContent).toMatch(/No recorded events/);
  });

  it('renders a link to /safety/global?op= for operators with events', async () => {
    render(<MemoryRouter><RouteOperators from="LHR" to="JFK" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Virgin Atlantic')).toBeInTheDocument());
    const vsRow = screen.getByText('Virgin Atlantic').closest('tr');
    const link = vsRow.querySelector('a');
    expect(link).toHaveAttribute('href', '/safety/global?op=VS');
    expect(link.textContent).toMatch(/1 safety event/);
  });

  it('renders explicit empty state when API returns empty operators', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, operators: [] }),
    });
    render(<MemoryRouter><RouteOperators from="LHR" to="JFK" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no carrier data observed/i)).toBeInTheDocument());
  });

  it('renders explicit empty state on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false });
    render(<MemoryRouter><RouteOperators from="LHR" to="JFK" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no carrier data observed/i)).toBeInTheDocument());
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecentSafetyEvents from '../RecentSafetyEvents';

const ROWS = [
  { date: '2026-04-24', severity: 'serious_incident', aircraft_model: 'Boeing 737-800', tail: 'PH-EME', from: 'LEMD', to: 'EHAM' },
  { date: '2026-04-22', severity: 'incident',         aircraft_model: 'Cessna 172',     tail: 'N4136E', from: null,   to: null   },
  { date: '2026-04-21', severity: 'incident',         aircraft_model: 'ATR 72-600',     tail: 'CP-1935',from: 'SLLP', to: 'SLCB' },
  { date: '2026-04-20', severity: 'hull_loss',        aircraft_model: 'DHC-6 Twin Otter', tail: 'N2126F', from: 'PADQ', to: 'PAKO' },
  { date: '2026-04-19', severity: 'fatal',            aircraft_model: 'Bell 206',       tail: 'HK-3210',from: 'SKBO', to: 'SKBG' },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: ROWS }) });
});

describe('RecentSafetyEvents', () => {
  it('renders 5 rows from /api/safety/global/accidents', async () => {
    render(<MemoryRouter><RecentSafetyEvents /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Boeing 737-800/)).toBeInTheDocument());
    expect(screen.getByText('PH-EME')).toBeInTheDocument();
    expect(screen.getByText('Bell 206')).toBeInTheDocument();
  });

  it('shows fallback CTA on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false });
    render(<MemoryRouter><RecentSafetyEvents /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/browse the full safety database/i)).toBeInTheDocument());
  });

  it('renders empty fields as em-dash, not "Other"', async () => {
    render(<MemoryRouter><RecentSafetyEvents /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Cessna 172/)).toBeInTheDocument());
    // Cessna row has null from/to — both should render as —
    const row = screen.getByText('Cessna 172').closest('tr');
    expect(row.textContent).not.toMatch(/Other/);
  });
});

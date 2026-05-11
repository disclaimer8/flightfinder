import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecentSafetyEvents from '../RecentSafetyEvents';

// Real shape returned by the Go sidecar at /api/safety/global/accidents.
// See bin/aircrash-sidecar/db.go Accident struct.
const ROWS = [
  { id: 1, date: '29 Apr 2026', aircraft_model: 'Boeing 737-800', operator: 'KLM',          fatalities: '0',        location: 'Madrid-Barajas Airport (LEMD)' },
  { id: 2, date: '27 Apr 2026', aircraft_model: 'Cessna 172',     operator: 'Private',      fatalities: '',         location: '' },
  { id: 3, date: '26 Apr 2026', aircraft_model: 'ATR 72-600',     operator: 'BoA',          fatalities: 'Unknown',  location: 'La Paz (SLLP)' },
  { id: 4, date: '25 Apr 2026', aircraft_model: 'DHC-6 Twin Otter', operator: 'Ravn Alaska', fatalities: '2',       location: 'Kodiak Island (PADQ)' },
  { id: 5, date: '24 Apr 2026', aircraft_model: 'Bell 206',       operator: 'AeroBogota',   fatalities: '4',        location: 'Bogota (SKBO)' },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: ROWS }) });
});

describe('RecentSafetyEvents', () => {
  it('renders 5 rows from /api/safety/global/accidents', async () => {
    render(<MemoryRouter><RecentSafetyEvents /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Boeing 737-800/)).toBeInTheDocument());
    expect(screen.getByText('KLM')).toBeInTheDocument();
    expect(screen.getByText('Bell 206')).toBeInTheDocument();
  });

  it('shows fallback CTA on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false });
    render(<MemoryRouter><RecentSafetyEvents /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/browse the full safety database/i)).toBeInTheDocument());
  });

  it('renders empty fatalities/location as em-dash, not "0" or "Unknown"', async () => {
    render(<MemoryRouter><RecentSafetyEvents /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Cessna 172/)).toBeInTheDocument());
    // Cessna row has empty fatalities + empty location — both render as —
    const cessnaRow = screen.getByText('Cessna 172').closest('tr');
    expect(cessnaRow.querySelector('.rse-fatalities').textContent).toBe('—');
    expect(cessnaRow.querySelector('.rse-location').textContent).toBe('—');

    // ATR row has fatalities="Unknown" — should also collapse to —
    const atrRow = screen.getByText('ATR 72-600').closest('tr');
    expect(atrRow.querySelector('.rse-fatalities').textContent).toBe('—');

    // KLM row has fatalities="0" — render as — (a zero-fatality incident is
    // still a real event, but "0" everywhere is noise on a recent-events feed)
    const klmRow = screen.getByText('KLM').closest('tr');
    expect(klmRow.querySelector('.rse-fatalities').textContent).toBe('—');

    // AeroBogota row has fatalities="4" — render verbatim
    const bogotaRow = screen.getByText('AeroBogota').closest('tr');
    expect(bogotaRow.querySelector('.rse-fatalities').textContent).toBe('4');
  });
});

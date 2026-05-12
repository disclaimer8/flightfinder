import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AccidentDetail from '../AccidentDetail';

const PAYLOAD = {
  slug: 'test-slug',
  narrative_text: 'A long narrative describing what happened.',
  probable_cause: 'Pilot lost situational awareness.',
  factors: ['Fatigue', 'Inadequate training'],
  phase_of_flight: 'APPROACH',
  weather_summary: 'IMC, ceiling 200ft',
  source_url: 'https://carol.ntsb.gov/event/E42',
  source: 'ntsb',
  indexable: 1,
  facts: {
    aircraft_model: 'BEECH F33A', operator: 'Private',
    fatalities: '2', location: 'Minneapolis, MN', date: '25 Apr 2026',
    lat: 44.97, lon: -93.26,
  },
  related: { byAircraft: [], byOperator: [] },
};

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => PAYLOAD,
  });
});

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/accidents/:slug" element={<AccidentDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AccidentDetail', () => {
  it('renders hero with aircraft + operator + date', async () => {
    renderAt('/accidents/test-slug');
    await waitFor(() => expect(screen.getByText(/BEECH F33A/)).toBeInTheDocument());
    expect(screen.getByText(/Private/)).toBeInTheDocument();
    expect(screen.getByText(/25 Apr 2026/)).toBeInTheDocument();
  });

  it('renders narrative + probable cause + factors', async () => {
    renderAt('/accidents/test-slug');
    await waitFor(() => expect(screen.getByText(/A long narrative/)).toBeInTheDocument());
    expect(screen.getByText('Pilot lost situational awareness.')).toBeInTheDocument();
    expect(screen.getByText('Fatigue')).toBeInTheDocument();
    expect(screen.getByText('Inadequate training')).toBeInTheDocument();
  });

  it('renders source attribution with external link', async () => {
    renderAt('/accidents/test-slug');
    await waitFor(() => expect(screen.getByText(/A long narrative/)).toBeInTheDocument());
    const link = screen.getByRole('link', { name: /carol\.ntsb\.gov/ });
    expect(link.getAttribute('href')).toBe('https://carol.ntsb.gov/event/E42');
    expect(link.getAttribute('rel')).toContain('external');
  });

  it('handles 410 gracefully (no crash)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 410, headers: new Headers({ Location: '/safety/global' }),
    });
    expect(() => renderAt('/accidents/low-quality')).not.toThrow();
    // Component should not crash on 410; specific redirect behavior is implementation detail
  });

  it('handles 404 with error message', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    renderAt('/accidents/missing');
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });
});

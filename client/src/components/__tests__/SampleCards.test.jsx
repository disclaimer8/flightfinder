import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SampleCards from '../SampleCards';

const FIXTURE = {
  sampleCards: [
    { eyebrow: 'A', headline: 'H1', body: 'B1', cta: 'C1', href: '/x' },
    { eyebrow: 'B', headline: 'H2', body: 'B2', cta: 'C2', href: '/y' },
    { eyebrow: 'C', headline: 'H3', body: 'B3', cta: 'C3', href: '/z' },
  ],
  browseAllAircraft: { label: 'Browse all', href: '/by-aircraft' },
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => FIXTURE });
});

describe('SampleCards', () => {
  it('renders 3 cards from JSON', async () => {
    render(<MemoryRouter><SampleCards /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('H1')).toBeInTheDocument());
    expect(screen.getByText('H2')).toBeInTheDocument();
    expect(screen.getByText('H3')).toBeInTheDocument();
  });

  it('renders Browse all aircraft link', async () => {
    render(<MemoryRouter><SampleCards /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/browse all/i)).toBeInTheDocument());
    const link = screen.getByText(/browse all/i).closest('a');
    expect(link).toHaveAttribute('href', '/by-aircraft');
  });

  it('renders nothing when fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false });
    const { container } = render(<MemoryRouter><SampleCards /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector('.sample-cards')).toBeNull());
  });
});

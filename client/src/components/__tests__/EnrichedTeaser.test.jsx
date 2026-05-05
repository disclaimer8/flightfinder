import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EnrichedTeaser from '../EnrichedTeaser';

describe('EnrichedTeaser', () => {
  it('renders 4 feature items', () => {
    render(<MemoryRouter><EnrichedTeaser /></MemoryRouter>);
    expect(screen.getByText(/Airline livery/i)).toBeInTheDocument();
    expect(screen.getByText(/On-time performance/i)).toBeInTheDocument();
    expect(screen.getByText(/CO₂/)).toBeInTheDocument();
    expect(screen.getByText(/Delay prediction/i)).toBeInTheDocument();
  });

  it('CTA links to /pricing', () => {
    render(<MemoryRouter><EnrichedTeaser /></MemoryRouter>);
    const cta = screen.getByText(/Unlock for/i);
    expect(cta.closest('a')).toHaveAttribute('href', '/pricing');
  });

  it('renders Pro badge', () => {
    render(<MemoryRouter><EnrichedTeaser /></MemoryRouter>);
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });
});

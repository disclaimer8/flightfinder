import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Pricing from '../pages/Pricing.jsx';

vi.mock('../utils/platform.js', () => ({ isNativeApp: () => false }));

describe('Pricing page', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('lifetime-status')) {
        return Promise.resolve({ ok: true, json: async () => ({ cap: 500, taken: 37, remaining: 463, soldOut: false }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }) });
    });
    delete window.location;
    window.location = { href: '', origin: 'https://himaxym.com' };
  });
  afterEach(() => {
    window.location = originalLocation;
    vi.restoreAllMocks();
  });

  it('renders all three tier cards with accessible names', async () => {
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    expect(await screen.findByLabelText('Pro Monthly')).toBeInTheDocument();
    expect(screen.getByLabelText('Pro Annual')).toBeInTheDocument();
    expect(screen.getByLabelText('Pro Lifetime')).toBeInTheDocument();
  });

  it('shows lifetime slots remaining once counter loads', async () => {
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/463 slots left/i)).toBeInTheDocument());
  });

  it('triggers checkout when a tier CTA is clicked', async () => {
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    await waitFor(() => screen.getByText(/463 slots left/i));
    const buttons = screen.getAllByRole('button', { name: /subscribe/i });
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/subscriptions/checkout',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});

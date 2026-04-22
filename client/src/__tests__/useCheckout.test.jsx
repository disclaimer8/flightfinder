import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCheckout } from '../hooks/useCheckout.js';

describe('useCheckout', () => {
  // Spy on window.location and swap in a writable stub so `href = ...` works.
  const originalLocation = window.location;

  beforeEach(() => {
    delete window.location;
    window.location = { href: '', origin: 'https://himaxym.com' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }),
    });
  });
  afterEach(() => {
    window.location = originalLocation;
    vi.restoreAllMocks();
  });

  it('posts to /api/subscriptions/checkout with tier', async () => {
    const { result } = renderHook(() => useCheckout());
    await act(async () => { await result.current.start('pro_monthly'); });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/subscriptions/checkout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tier: 'pro_monthly' }),
      }),
    );
  });

  it('sets error when server returns LIFETIME_SOLD_OUT', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ success: false, code: 'LIFETIME_SOLD_OUT', message: 'Lifetime slots are gone' }),
    });
    const { result } = renderHook(() => useCheckout());
    await act(async () => { await result.current.start('pro_lifetime'); });
    expect(result.current.error).toMatch(/sold out/i);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLifetimeStatus } from '../hooks/useLifetimeStatus.js';

describe('useLifetimeStatus', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cap: 500, taken: 37, remaining: 463, soldOut: false }),
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('fetches lifetime-status on mount', async () => {
    const { result } = renderHook(() => useLifetimeStatus());
    await waitFor(() => expect(result.current.status).toBeTruthy());
    expect(result.current.status.taken).toBe(37);
    expect(result.current.status.soldOut).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith('/api/subscriptions/lifetime-status', expect.any(Object));
  });

  it('derives remaining+soldOut from server shape {taken,cap,available}', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, taken: 500, cap: 500, available: 0 }),
    });
    const { result } = renderHook(() => useLifetimeStatus());
    await waitFor(() => expect(result.current.status).toBeTruthy());
    expect(result.current.status.remaining).toBe(0);
    expect(result.current.status.soldOut).toBe(true);
  });

  it('exposes error when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { result } = renderHook(() => useLifetimeStatus());
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});

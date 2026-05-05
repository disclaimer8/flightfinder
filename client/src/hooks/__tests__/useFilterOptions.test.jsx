import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFilterOptions, _resetForTests } from '../useFilterOptions';

beforeEach(() => {
  _resetForTests();
  vi.restoreAllMocks();
});

describe('useFilterOptions', () => {
  it('fetches /api/flights/filter-options once and shares the result across hooks', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ aircraftTypes: ['jet'], apiStatus: { ok: true } }),
    });

    const { result: r1 } = renderHook(() => useFilterOptions());
    const { result: r2 } = renderHook(() => useFilterOptions());

    await waitFor(() => expect(r1.current.filterOptions).not.toBeNull());
    await waitFor(() => expect(r2.current.filterOptions).not.toBeNull());

    expect(r1.current.apiStatus).toEqual({ ok: true });
    expect(r2.current.filterOptions).toEqual({ aircraftTypes: ['jet'], apiStatus: { ok: true } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('exposes error state on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, statusText: 'Server Error' });
    const { result } = renderHook(() => useFilterOptions());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.filterOptions).toBeNull();
    expect(result.current.apiStatus).toBeNull();
  });
});

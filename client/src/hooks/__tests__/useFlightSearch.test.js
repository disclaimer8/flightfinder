import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useUrlFlightSearch } from '../useFlightSearch';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseState = {
  from: 'LHR', to: 'JFK', date: '2099-01-15', return: '',
  pax: 1, cabin: 'economy', flexDates: false,
  aircraft: [], airlines: [], direct: false,
  sort: 'cheapest', shown: 7,
};

describe('useUrlFlightSearch URL-driven', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [], source: 'mock' }),
      })
    ));
  });

  test('does NOT fire fetch when from missing', async () => {
    renderHook(() => useUrlFlightSearch({ ...baseState, from: '' }));
    await new Promise(r => setTimeout(r, 50));
    expect(fetch).not.toHaveBeenCalled();
  });

  test('does NOT fire fetch when state is null', async () => {
    renderHook(() => useUrlFlightSearch(null));
    await new Promise(r => setTimeout(r, 50));
    expect(fetch).not.toHaveBeenCalled();
  });

  test('fires fetch when state has from/to/date', async () => {
    renderHook(() => useUrlFlightSearch(baseState));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toMatch(/departure=LHR/);
    expect(url).toMatch(/arrival=JFK/);
    expect(url).toMatch(/date=2099-01-15/);
    expect(url).toMatch(/cabin=economy/);
  });

  test('does not refire when filter-only param changes (aircraft)', async () => {
    const { rerender } = renderHook(({ s }) => useUrlFlightSearch(s), { initialProps: { s: baseState } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ s: { ...baseState, aircraft: ['boeing-787'] } });
    await new Promise(r => setTimeout(r, 50));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('does not refire when display-only param changes (sort)', async () => {
    const { rerender } = renderHook(({ s }) => useUrlFlightSearch(s), { initialProps: { s: baseState } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ s: { ...baseState, sort: 'safety' } });
    await new Promise(r => setTimeout(r, 50));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('refires when date changes', async () => {
    const { rerender } = renderHook(({ s }) => useUrlFlightSearch(s), { initialProps: { s: baseState } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ s: { ...baseState, date: '2099-02-15' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  test('refires when cabin changes', async () => {
    const { rerender } = renderHook(({ s }) => useUrlFlightSearch(s), { initialProps: { s: baseState } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ s: { ...baseState, cabin: 'business' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  test('refires when flexDates changes', async () => {
    const { rerender } = renderHook(({ s }) => useUrlFlightSearch(s), { initialProps: { s: baseState } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ s: { ...baseState, flexDates: true } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  test('forwards flex_dates=1 in API call when flexDates true', async () => {
    renderHook(() => useUrlFlightSearch({ ...baseState, flexDates: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toMatch(/flex_dates=1/);
  });

  test('forwards directOnly=1 in API call when direct true', async () => {
    renderHook(() => useUrlFlightSearch({ ...baseState, direct: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toMatch(/directOnly=1/);
  });

  test('returns flights and source from API', async () => {
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'BA178' }], source: 'google' }),
      })
    );
    const { result } = renderHook(() => useUrlFlightSearch(baseState));
    await waitFor(() => expect(result.current.flights).toHaveLength(1));
    expect(result.current.apiSource).toBe('google');
    expect(result.current.hasSearched).toBe(true);
  });

  test('handles non-ok response with error message', async () => {
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false, statusText: 'Bad Gateway',
        json: () => Promise.resolve({ error: 'Upstream timeout' }),
      })
    );
    const { result } = renderHook(() => useUrlFlightSearch(baseState));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toMatch(/Upstream timeout/);
  });

  test('clearError clears the error state', async () => {
    fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false, statusText: 'Bad Gateway',
        json: () => Promise.resolve({ error: 'Upstream timeout' }),
      })
    );
    const { result } = renderHook(() => useUrlFlightSearch(baseState));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

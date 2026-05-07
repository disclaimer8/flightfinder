import { describe, it, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFlightSearch, useUrlFlightSearch } from '../useFlightSearch';

function okResponse(data) {
  return {
    ok: true,
    statusText: 'OK',
    json: () => Promise.resolve(data),
  };
}

function errorResponse(statusText = 'Internal Server Error') {
  return {
    ok: false,
    statusText,
    json: () => Promise.resolve({ error: statusText }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFlightSearch', () => {
  it('starts with empty state', () => {
    const { result } = renderHook(() => useFlightSearch(null));
    expect(result.current.flights).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasSearched).toBe(false);
  });

  it('sets flights and hasSearched on successful search', async () => {
    const mockFlights = [{ id: '1', price: '200', airline: 'AA' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      okResponse({ data: mockFlights, source: 'google' })
    ));

    const { result } = renderHook(() => useFlightSearch(null));

    await act(async () => {
      await result.current.handleSearch({ departure: 'JFK', arrival: 'LAX', date: '2024-06-01', passengers: '1' });
    });

    expect(result.current.flights).toEqual(mockFlights);
    expect(result.current.hasSearched).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.apiSource).toBe('google');
  });

  it('sets error on failed search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { result } = renderHook(() => useFlightSearch(null));

    await act(async () => {
      await result.current.handleSearch({ departure: 'JFK', arrival: 'LAX', date: '2024-06-01', passengers: '1' });
    });

    expect(result.current.error).toMatch(/search failed/i);
    expect(result.current.loading).toBe(false);
  });

  it('sets error on non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse('Bad Gateway')));

    const { result } = renderHook(() => useFlightSearch(null));

    await act(async () => {
      await result.current.handleSearch({ departure: 'JFK', arrival: 'LAX', date: '2024-06-01', passengers: '1' });
    });

    expect(result.current.error).toMatch(/search failed/i);
    expect(result.current.loading).toBe(false);
  });

  it('clearError resets the error state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));

    const { result } = renderHook(() => useFlightSearch(null));
    await act(async () => {
      await result.current.handleSearch({ departure: 'JFK', arrival: 'LAX', date: '2024-06-01' });
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it('sets exploreResults on successful explore', async () => {
    const mockDestinations = [{ destination: { code: 'CDG', city: 'Paris', country: 'France', flag: '🇫🇷' }, price: '350' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      okResponse({ data: mockDestinations })
    ));

    const filterOptions = { aircraft: [] };
    const { result } = renderHook(() => useFlightSearch(filterOptions));

    await act(async () => {
      await result.current.handleExplore({ departure: 'JFK', aircraftType: 'jet', date: '2024-06-01' });
    });

    expect(result.current.exploreResults).toEqual(mockDestinations);
    expect(result.current.loading).toBe(false);
  });
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

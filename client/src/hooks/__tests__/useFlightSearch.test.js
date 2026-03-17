import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import axios from 'axios';
import { useFlightSearch } from '../useFlightSearch';

vi.mock('axios');

describe('useFlightSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with empty state', () => {
    const { result } = renderHook(() => useFlightSearch(null));
    expect(result.current.flights).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasSearched).toBe(false);
  });

  it('sets flights and hasSearched on successful search', async () => {
    const mockFlights = [{ id: '1', price: '200', airline: 'AA' }];
    axios.get.mockResolvedValueOnce({ data: { data: mockFlights, source: 'amadeus' } });

    const { result } = renderHook(() => useFlightSearch(null));

    await act(async () => {
      await result.current.handleSearch({ departure: 'JFK', arrival: 'LAX', date: '2024-06-01', passengers: '1' });
    });

    expect(result.current.flights).toEqual(mockFlights);
    expect(result.current.hasSearched).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.apiSource).toBe('amadeus');
  });

  it('sets error on failed search', async () => {
    axios.get.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useFlightSearch(null));

    await act(async () => {
      await result.current.handleSearch({ departure: 'JFK', arrival: 'LAX', date: '2024-06-01', passengers: '1' });
    });

    expect(result.current.error).toMatch(/search failed/i);
    expect(result.current.loading).toBe(false);
  });

  it('clearError resets the error state', async () => {
    axios.get.mockRejectedValueOnce(new Error('fail'));

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
    axios.get.mockResolvedValueOnce({ data: { data: mockDestinations } });

    const filterOptions = { aircraft: [] };
    const { result } = renderHook(() => useFlightSearch(filterOptions));

    await act(async () => {
      await result.current.handleExplore({ departure: 'JFK', aircraftType: 'jet', date: '2024-06-01' });
    });

    expect(result.current.exploreResults).toEqual(mockDestinations);
    expect(result.current.loading).toBe(false);
  });
});

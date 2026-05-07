import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { AuthProvider } from '../../context/AuthContext';
import { _resetForTests } from '../../hooks/useFilterOptions';
import Search from '../Search';

function mockOk(body) {
  return { ok: true, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  _resetForTests();
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (String(url).includes('/api/filter-options')) {
      return Promise.resolve(mockOk({ aircraftTypes: [], aircraftModels: [], airlines: [] }));
    }
    if (String(url).includes('/api/flights')) {
      return Promise.resolve(mockOk({ data: [], source: 'mock' }));
    }
    return Promise.resolve(mockOk({}));
  }));
});

function renderAt(path) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Search />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Search page (Phase 2)', () => {
  test('still has page-search test-id', () => {
    renderAt('/search');
    expect(screen.getByTestId('page-search')).toBeInTheDocument();
  });

  test('renders empty state when from/to/date missing', () => {
    renderAt('/search');
    expect(screen.getByText(/search for flights/i)).toBeInTheDocument();
  });

  test('with from/to/date in URL fires API call to /api/flights', async () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15');
    await waitFor(() => {
      const calls = fetch.mock.calls.map(c => String(c[0]));
      expect(calls.some(u => u.includes('/api/flights') && u.includes('departure=LHR'))).toBe(true);
    });
  });

  test('cabin from URL is forwarded to API', async () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15&cabin=business');
    await waitFor(() => {
      const calls = fetch.mock.calls.map(c => String(c[0]));
      expect(calls.some(u => u.includes('cabin=business'))).toBe(true);
    });
  });

  test('renders summary line with from/to/date', async () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15');
    await waitFor(() => {
      // Summary line should contain LHR → JFK and date
      const summary = screen.getByText((content) => content.includes('LHR') && content.includes('JFK'));
      expect(summary).toBeInTheDocument();
    });
  });
});

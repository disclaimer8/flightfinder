import { render, screen } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import { _resetForTests } from '../../hooks/useFilterOptions';
import Home from '../Home';

beforeEach(() => {
  _resetForTests();
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/filter-options')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }));
});

function renderHome(path = '/') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Home />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Home page (Phase 4)', () => {
  test('renders hero H1', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: /aircraft/i })).toBeInTheDocument();
  });

  test('renders HomeSearchBar (Search flights submit button)', () => {
    renderHome();
    expect(screen.getByRole('button', { name: /search flights/i })).toBeInTheDocument();
  });

  test('renders AircraftBrowser region', () => {
    renderHome();
    expect(screen.getByRole('region', { name: /browse by aircraft/i })).toBeInTheDocument();
  });

  test('does NOT render SampleCards (3 promo blocks)', () => {
    renderHome();
    // The original SampleCards used "FOR AVGEEKS / FOR TRAVELERS / FOR RESEARCHERS" eyebrows
    expect(screen.queryByText(/for avgeeks/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/for travelers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/for researchers/i)).not.toBeInTheDocument();
  });

  test('does NOT render mode-switching tabs (moved to header)', () => {
    renderHome();
    expect(screen.queryByRole('button', { name: /^route map$/i })).not.toBeInTheDocument();
  });
});

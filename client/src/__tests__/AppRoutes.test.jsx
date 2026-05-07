import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { _resetForTests } from '../hooks/useFilterOptions';
import AppRoutes from '../AppRoutes';

function mockFetch(response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

function okResponse(data) {
  return {
    ok: true,
    statusText: 'OK',
    json: () => Promise.resolve(data),
  };
}

const FILTER_OPTIONS = {
  cities: [
    { code: 'JFK', name: 'New York' },
    { code: 'LAX', name: 'Los Angeles' },
  ],
  aircraft: [{ code: '738', name: 'Boeing 737-800', type: 'jet' }],
  aircraftTypes: ['jet', 'turboprop'],
  apiStatus: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  mockFetch(okResponse(FILTER_OPTIONS));
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetForTests();
});

function renderAt(path) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('AppRoutes', () => {
  test('mounts Home at /', () => {
    renderAt('/');
    expect(screen.getByTestId('page-home')).toBeInTheDocument();
  });

  test('mounts Search at /search', () => {
    renderAt('/search');
    expect(screen.getByTestId('page-search')).toBeInTheDocument();
  });

  test('mounts Map at /map', () => {
    renderAt('/map');
    expect(screen.getByTestId('page-map')).toBeInTheDocument();
  });

  test('preserves /by-aircraft route', () => {
    renderAt('/by-aircraft');
    // SiteLayout wraps it; AircraftIndex is lazy. Just assert no crash and that we're not at home.
    expect(screen.queryByTestId('page-home')).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import { _resetForTests } from '../../hooks/useFilterOptions';
import Map from '../Map';

const FILTER_OPTIONS = {
  cities: [],
  aircraft: [],
  aircraftTypes: [],
  apiStatus: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    statusText: 'OK',
    json: () => Promise.resolve(FILTER_OPTIONS),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetForTests();
});

test('Map renders with map test-id', () => {
  render(
    <MemoryRouter>
      <AuthProvider>
        <Map />
      </AuthProvider>
    </MemoryRouter>
  );
  expect(screen.getByTestId('page-map')).toBeInTheDocument();
});

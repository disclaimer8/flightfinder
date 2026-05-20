import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import Map from '../Map';

// Stub fetch so fetchRoutes + fetchFilters + fetchAirports don't throw.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ routes: [], airlines: [], aircraft: [] }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('Map renders the page heading', () => {
  render(
    <AuthProvider>
      <MemoryRouter>
        <Map />
      </MemoryRouter>
    </AuthProvider>
  );
  // Heading is visually hidden (position: absolute; left: -9999px) but still accessible.
  expect(screen.getByRole('heading', { name: /flight route map/i })).toBeInTheDocument();
});

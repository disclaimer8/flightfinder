import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Map from '../Map';

// Stub fetch so fetchRoutes + fetchFilters don't throw.
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
    <MemoryRouter>
      <Map />
    </MemoryRouter>
  );
  expect(screen.getByRole('heading', { name: /flight route map/i })).toBeInTheDocument();
});

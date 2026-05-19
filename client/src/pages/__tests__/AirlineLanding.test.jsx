import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AirlineLanding from '../AirlineLanding';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/airline/:iata" element={<AirlineLanding />} />
      </Routes>
    </MemoryRouter>
  );
}

function okResponse(data) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}
function notFoundResponse() {
  return { ok: false, status: 404, json: () => Promise.resolve({ error: 'no airline data' }) };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('AirlineLanding', () => {
  it('shows loading then renders airline name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({
      success: true,
      airline: { iata: 'LH', icao: 'DLH', name: 'Lufthansa' },
      jonty: null,
      observed: { topAircraft: [], hubs: [], topDests: [] },
    })));
    renderAt('/airline/lh');
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Lufthansa.*destinations and fleet/i);
  });

  it('shows empty state on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFoundResponse()));
    renderAt('/airline/zzz');
    await waitFor(() => expect(screen.getByText(/still gathering/i)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /by aircraft/i })).toHaveAttribute('href', '/by-aircraft');
  });

  it('shows generic error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    renderAt('/airline/lh');
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
  });
});

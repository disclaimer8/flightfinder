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

  const FULL_PAYLOAD = {
    success: true,
    airline: { iata: 'LH', icao: 'DLH', name: 'Lufthansa' },
    jonty: {
      totalRoutes: 287, totalCountries: 64, hubCount: 3,
      origins: [
        { iata: 'FRA', city: 'Frankfurt', country: 'Germany', routeCount: 142 },
        { iata: 'MUC', city: 'Munich',    country: 'Germany', routeCount: 78 },
      ],
    },
    observed: {
      topAircraft: [
        { icao: 'A320', name: 'Airbus A320',   nPairs: 87, hasMatrix: true },
        { icao: 'B748', name: 'Boeing 747-8',  nPairs: 12, hasMatrix: false },
      ],
      hubs: [
        { iata: 'FRA', city: 'Frankfurt', country: 'Germany', pairCount: 142 },
      ],
      topDests: [
        { iata: 'JFK', city: 'New York', country: 'USA', pairCount: 12 },
      ],
    },
  };

  it('renders intro stats when jonty data present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(FULL_PAYLOAD)));
    renderAt('/airline/lh');
    await waitFor(() => expect(screen.getByText(/287 non-stop routes/i)).toBeInTheDocument());
    expect(screen.getByText(/64 countries/i)).toBeInTheDocument();
  });

  it('renders origins list with links to /airline/:iata/from/:origin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(FULL_PAYLOAD)));
    renderAt('/airline/lh');
    await waitFor(() => expect(screen.getByText(/Where Lufthansa flies from/i)).toBeInTheDocument());
    const fraLink = screen.getByRole('link', { name: /Frankfurt.*FRA.*142/i });
    expect(fraLink).toHaveAttribute('href', '/airline/lh/from/FRA');
  });

  it('renders top aircraft with matrix link only when hasMatrix=true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(FULL_PAYLOAD)));
    renderAt('/airline/lh');
    await waitFor(() => expect(screen.getByText(/Top aircraft/i)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Airbus A320/i })).toHaveAttribute('href', '/airline/lh/aircraft/a320');
    expect(screen.queryByRole('link', { name: /Boeing 747-8/i })).toBeNull();
    expect(screen.getByText(/Boeing 747-8/i)).toBeInTheDocument();
  });

  it('renders hubs + top destinations + safety link to /safety/global', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(FULL_PAYLOAD)));
    renderAt('/airline/lh');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /Hub airports/i })).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 2, name: /Top destinations/i })).toBeInTheDocument();
    expect(screen.getByText(/Frankfurt, Germany/)).toBeInTheDocument();
    expect(screen.getByText(/New York, USA/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /safety database/i })).toHaveAttribute('href', '/safety/global?op=DLH');
  });

  it('hides jonty sections when jonty=null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({
      ...FULL_PAYLOAD,
      jonty: null,
    })));
    renderAt('/airline/lh');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.queryByText(/Where Lufthansa flies from/i)).toBeNull();
    expect(screen.queryByText(/non-stop routes/i)).toBeNull();
    expect(screen.getByText(/Top aircraft/i)).toBeInTheDocument();
  });
});

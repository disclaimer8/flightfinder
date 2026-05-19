import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AircraftTopRoutesPrices from '../AircraftTopRoutesPrices';

function renderWith(icao, familyLabel) {
  return render(
    <MemoryRouter>
      <AircraftTopRoutesPrices icao={icao} familyLabel={familyLabel} />
    </MemoryRouter>
  );
}

function okResponse(data) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}
function notFoundResponse() {
  return { ok: false, status: 404, json: () => Promise.resolve({ error: 'no price data' }) };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

const FULL = {
  success: true,
  aircraft_icao: 'B789',
  routes: [
    { dep_iata: 'LHR', arr_iata: 'JFK', dep_city: 'London', arr_city: 'New York',
      median_eur: 500, min_eur: 400, max_eur: 600, n_quotes: 12 },
    { dep_iata: 'LAX', arr_iata: 'LHR', dep_city: 'Los Angeles', arr_city: 'London',
      median_eur: 620, min_eur: 500, max_eur: 800, n_quotes: 8 },
    { dep_iata: 'SFO', arr_iata: 'LHR', dep_city: 'San Francisco', arr_city: 'London',
      median_eur: 700, min_eur: 600, max_eur: 900, n_quotes: 5 },
  ],
};

describe('AircraftTopRoutesPrices', () => {
  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFoundResponse()));
    const { container } = renderWith('B789', 'Boeing 787-9');
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const { container } = renderWith('B789', 'Boeing 787-9');
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('returns null when fewer than 3 routes (suppress thin)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({
      success: true, aircraft_icao: 'B789',
      routes: [
        { dep_iata: 'LHR', arr_iata: 'JFK', dep_city: 'London', arr_city: 'New York',
          median_eur: 500, min_eur: 400, max_eur: 600, n_quotes: 12 },
        { dep_iata: 'LAX', arr_iata: 'LHR', dep_city: 'Los Angeles', arr_city: 'London',
          median_eur: 620, min_eur: 500, max_eur: 800, n_quotes: 8 },
      ],
    })));
    const { container } = renderWith('B789', 'Boeing 787-9');
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });

  it('renders top routes with proper links and family label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(FULL)));
    renderWith('B789', 'Boeing 787-9');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/Where the Boeing 787-9 flies/i);
    expect(screen.getByText(/London → New York/)).toBeInTheDocument();
    expect(screen.getByText(/Los Angeles → London/)).toBeInTheDocument();
    expect(screen.getByText(/San Francisco → London/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /London → New York/ })).toHaveAttribute('href', '/routes/lhr-jfk');
    expect(screen.getByRole('link', { name: /San Francisco → London/ })).toHaveAttribute('href', '/routes/sfo-lhr');
    expect(screen.getByText('€500')).toBeInTheDocument();
    expect(screen.getByText('€700')).toBeInTheDocument();
    expect(screen.getByText(/12 quotes/)).toBeInTheDocument();
  });

  it('falls back to ICAO when familyLabel missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(FULL)));
    renderWith('B789', undefined);
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/Where the B789 flies/);
  });
});

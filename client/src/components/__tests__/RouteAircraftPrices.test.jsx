import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RouteAircraftPrices from '../RouteAircraftPrices';

function renderWith(pair) {
  return render(
    <MemoryRouter>
      <RouteAircraftPrices pair={pair} />
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

const FULL_PAYLOAD = {
  success: true,
  dep: 'LHR',
  arr: 'JFK',
  prices: [
    {
      aircraft_icao: 'B789', aircraft_name: 'Boeing 787-9', aircraft_slug: 'boeing-787-9',
      median_eur: 500, min_eur: 400, max_eur: 600, n_quotes: 8,
      airlines: ['BAW'], airlines_display: 'British Airways',
      safety: { accident_count_5y: 0, level: 'green' },
      snapshot_at: 1779215000000,
    },
    {
      aircraft_icao: 'A388', aircraft_name: 'Airbus A380', aircraft_slug: 'airbus-a380',
      median_eur: 700, min_eur: 600, max_eur: 800, n_quotes: 4,
      airlines: ['BAW'], airlines_display: 'British Airways',
      safety: { accident_count_5y: 1, level: 'yellow' },
      snapshot_at: 1779215000000,
    },
  ],
};

describe('RouteAircraftPrices', () => {
  it('returns null on 404 (no DOM)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFoundResponse()));
    const { container } = renderWith('lhr-jfk');
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('returns null on network error (no DOM)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const { container } = renderWith('lhr-jfk');
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('returns null on empty prices array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ success: true, prices: [] })));
    const { container } = renderWith('lhr-jfk');
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders table with sorted rows on full data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(FULL_PAYLOAD)));
    renderWith('lhr-jfk');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/Typical fares by aircraft on this route/i);
    expect(screen.getByText(/Boeing 787-9/)).toBeInTheDocument();
    expect(screen.getByText(/Airbus A380/)).toBeInTheDocument();
    expect(screen.getByText('€500')).toBeInTheDocument();
    expect(screen.getByText('€700')).toBeInTheDocument();
    expect(screen.getByText(/No incidents 5y/)).toBeInTheDocument();
    expect(screen.getByText(/1 incident 5y/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Boeing 787-9/ })).toHaveAttribute('href', '/aircraft/boeing-787-9');
    expect(screen.getByRole('link', { name: /Airbus A380/ })).toHaveAttribute('href', '/aircraft/airbus-a380');
    const gfLinks = screen.getAllByText(/Check fares/);
    expect(gfLinks).toHaveLength(2);
    expect(gfLinks[0].closest('a')).toHaveAttribute('target', '_blank');
    expect(gfLinks[0].closest('a').getAttribute('href')).toMatch(/google.com\/travel\/flights.*to%20JFK%20from%20LHR.*oneway/);
    expect(screen.getByText(/Based on 12 recent fare observations/)).toBeInTheDocument();
  });

  it('table rows are sorted by median ASC (cheapest first)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(FULL_PAYLOAD)));
    renderWith('lhr-jfk');
    await waitFor(() => expect(screen.getByText(/Boeing 787-9/)).toBeInTheDocument());
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Boeing 787-9');
    expect(rows[1]).toHaveTextContent('€500');
    expect(rows[2]).toHaveTextContent('Airbus A380');
    expect(rows[2]).toHaveTextContent('€700');
  });
});

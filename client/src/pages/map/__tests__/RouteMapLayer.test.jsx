import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// ── react-router-dom mock ─────────────────────────────────────────────────────
// Must be declared before the component import so Vitest hoisting picks it up.
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

// ── Leaflet mock ─────────────────────────────────────────────────────────────
// RouteMapLayer dynamic-imports leaflet. We intercept the whole module so no
// real DOM canvas / tile requests are made in JSDOM.

// Each polyline instance tracks its own event handlers keyed by event name.
function makeMockPolyline() {
  const handlers = {};
  const instance = {
    bindTooltip: vi.fn().mockReturnThis(),
    on: vi.fn((event, cb) => { handlers[event] = cb; return instance; }),
    addTo: vi.fn().mockReturnThis(),
    setStyle: vi.fn(),
    _handlers: handlers,
  };
  return instance;
}

const mockPolyline = vi.fn(() => makeMockPolyline());

const mockGroup = {
  addTo: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

const mockMap = {
  remove: vi.fn(),
  setView: vi.fn().mockReturnThis(),
  invalidateSize: vi.fn(),
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
};

const mockTileLayer = {
  addTo: vi.fn().mockReturnThis(),
};

const mockCanvas = vi.fn(() => ({}));

vi.mock('leaflet', () => ({
  default: {
    map:        vi.fn(() => mockMap),
    tileLayer:  vi.fn(() => mockTileLayer),
    polyline:   mockPolyline,
    layerGroup: vi.fn(() => mockGroup),
    canvas:     mockCanvas,
  },
}));

// Also stub the CSS import so JSDOM doesn't choke on it.
vi.mock('leaflet/dist/leaflet.css', () => ({}));

// ── Import component AFTER mocks are declared ────────────────────────────────
// Vitest hoists vi.mock calls, so by the time the module resolves the mock is
// already in place.
import RouteMapLayer from '../RouteMapLayer';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderLayer(props = {}) {
  const defaults = { routes: [], filters: { airline: null, aircraft: null }, loading: false };
  return render(<RouteMapLayer {...defaults} {...props} />);
}

const ROUTE_LHR_JFK = {
  dep: { iata: 'LHR', lat: 51.477,  lon: -0.461  },
  arr: { iata: 'JFK', lat: 40.641,  lon: -73.778 },
  airline_count:  5,
  aircraft_count: 3,
};

// SFO → HND crosses the antimeridian: |139.8 - (-122.4)| = 262.2 > 180
// arr.lon should be shifted by -360 → 139.8 - 360 = -220.2
const ROUTE_SFO_HND = {
  dep: { iata: 'SFO', lat: 37.6,  lon: -122.4 },
  arr: { iata: 'HND', lat: 35.5,  lon:  139.8 },
  airline_count:  2,
  aircraft_count: 1,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RouteMapLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockReset();
  });

  // 1. Component mounts without throwing ──────────────────────────────────────
  it('mounts without throwing', () => {
    expect(() => renderLayer()).not.toThrow();
  });

  // 2. With routes=[], no polyline calls made ─────────────────────────────────
  it('does not call L.polyline when routes is empty', async () => {
    renderLayer({ routes: [] });
    // Flush microtasks so the async useEffect (dynamic import) can run.
    await vi.waitFor(() => {
      expect(mockPolyline).not.toHaveBeenCalled();
    });
  });

  // 3. With 1 route, L.polyline called once with correct coords ───────────────
  it('calls L.polyline once with correct lat/lon coordinates for a single route', async () => {
    renderLayer({ routes: [ROUTE_LHR_JFK] });

    await vi.waitFor(() => {
      expect(mockPolyline).toHaveBeenCalledTimes(1);
    });

    const [[coords]] = mockPolyline.mock.calls;
    expect(coords).toEqual([
      [ROUTE_LHR_JFK.dep.lat, ROUTE_LHR_JFK.dep.lon],
      [ROUTE_LHR_JFK.arr.lat, ROUTE_LHR_JFK.arr.lon],
    ]);
  });

  // 4. Click handler navigates to /search?from=LHR&to=JFK ────────────────────
  it('polyline click navigates to /search?from=LHR&to=JFK', async () => {
    renderLayer({ routes: [ROUTE_LHR_JFK] });

    await vi.waitFor(() => {
      expect(mockPolyline).toHaveBeenCalledTimes(1);
    });

    // Retrieve the polyline instance and invoke its click handler.
    const polylineInstance = mockPolyline.mock.results[0].value;
    expect(polylineInstance._handlers['click']).toBeDefined();
    polylineInstance._handlers['click']();

    expect(navigateMock).toHaveBeenCalledWith('/search?from=LHR&to=JFK');
  });

  // 5. Antimeridian path: SFO → HND shifts arr.lon by -360 ──────────────────
  it('adjusts arr.lon by -360 for a route crossing the antimeridian (SFO→HND)', async () => {
    renderLayer({ routes: [ROUTE_SFO_HND] });

    await vi.waitFor(() => {
      expect(mockPolyline).toHaveBeenCalledTimes(1);
    });

    const [[coords]] = mockPolyline.mock.calls;
    // dep stays unchanged; arr.lon = 139.8 - 360 = -220.2
    expect(coords[0]).toEqual([37.6, -122.4]);
    expect(coords[1][0]).toBeCloseTo(35.5, 5);
    expect(coords[1][1]).toBeCloseTo(-220.2, 5);
  });
});

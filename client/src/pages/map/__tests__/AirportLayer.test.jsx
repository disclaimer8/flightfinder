import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// vi.hoisted ensures these are initialised before vi.mock factory runs (which
// is hoisted to the top of the file by Vitest's transform).
const { mockCircleMarker, mockLayerGroup, mockMap, circleClicks } = vi.hoisted(() => {
  const circleClicks = new Map();
  const mockCircleMarker = vi.fn((latlng, opts) => {
    const handlers = {};
    const inst = {
      addTo: vi.fn().mockReturnThis(),
      on: vi.fn((evt, cb) => { handlers[evt] = cb; circleClicks.set(opts._iata, cb); return inst; }),
      bindTooltip: vi.fn().mockReturnThis(),
      setStyle: vi.fn(),
      _iata: opts._iata,
    };
    return inst;
  });
  const mockLayerGroup = { addTo: vi.fn().mockReturnThis(), remove: vi.fn() };
  const mockMap = {
    getZoom: vi.fn(() => 4),
    on: vi.fn(),
    off: vi.fn(),
  };
  return { mockCircleMarker, mockLayerGroup, mockMap, circleClicks };
});

vi.mock('leaflet', () => ({
  default: {
    circleMarker: mockCircleMarker,
    layerGroup: vi.fn(() => mockLayerGroup),
  },
}));

import AirportLayer from '../AirportLayer';

const AIRPORTS = [
  { iata: 'LHR', name: 'Heathrow', city: 'London',  country: 'UK', lat: 51.4, lon: -0.4, degree: 200 },
  { iata: 'JFK', name: 'JFK',      city: 'NY',      country: 'US', lat: 40.6, lon: -73.7, degree: 150 },
  { iata: 'XYZ', name: 'Small',    city: 'Nowhere', country: '??', lat: 0,    lon: 0,    degree: 1 },
];

describe('AirportLayer', () => {
  it('renders one circleMarker per visible airport at zoom 4 (top 1000)', () => {
    mockCircleMarker.mockClear();
    render(<AirportLayer mapRef={{ current: mockMap }} airports={AIRPORTS} onSelect={() => {}} selectedIata={null} />);
    // All 3 fit under top-1000 cap → all rendered
    expect(mockCircleMarker).toHaveBeenCalledTimes(3);
  });

  it('caps to top 200 by degree at zoom <= 3', () => {
    mockCircleMarker.mockClear();
    mockMap.getZoom.mockReturnValueOnce(3);
    const many = Array.from({ length: 500 }, (_, i) => ({
      iata: `A${i}`, name: `Airport ${i}`, lat: 0, lon: 0, degree: 500 - i,
    }));
    render(<AirportLayer mapRef={{ current: mockMap }} airports={many} onSelect={() => {}} selectedIata={null} />);
    expect(mockCircleMarker).toHaveBeenCalledTimes(200);
  });

  it('invokes onSelect(iata) when a dot is clicked', () => {
    mockCircleMarker.mockClear();
    circleClicks.clear();
    const onSelect = vi.fn();
    render(<AirportLayer mapRef={{ current: mockMap }} airports={AIRPORTS} onSelect={onSelect} selectedIata={null} />);
    // Simulate click on LHR
    const lhrClick = circleClicks.get('LHR');
    expect(lhrClick).toBeDefined();
    lhrClick();
    expect(onSelect).toHaveBeenCalledWith('LHR');
  });

  it('returns null DOM (Leaflet layers render outside React)', () => {
    const { container } = render(<AirportLayer mapRef={{ current: mockMap }} airports={AIRPORTS} onSelect={() => {}} selectedIata={null} />);
    expect(container.firstChild).toBeNull();
  });
});

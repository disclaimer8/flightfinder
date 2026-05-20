import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const { mockHeatLayer, heatCtor } = vi.hoisted(() => {
  const mockHeatLayer = {
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    setLatLngs: vi.fn(),
    setOptions: vi.fn(),
  };
  const heatCtor = vi.fn(() => mockHeatLayer);
  return { mockHeatLayer, heatCtor };
});

vi.mock('leaflet', () => ({
  default: { heatLayer: heatCtor },
}));
vi.mock('leaflet.heat', () => ({}));  // side-effect import, no exports

import HeatmapLayer from '../HeatmapLayer';

const mockMap = { getZoom: vi.fn(() => 3), on: vi.fn(), off: vi.fn() };

const ROUTES = [
  { dep: { iata: 'LHR', lat: 51.4, lon: -0.4 }, arr: { iata: 'JFK', lat: 40.6, lon: -73.7 } },
  { dep: { iata: 'LHR', lat: 51.4, lon: -0.4 }, arr: { iata: 'CDG', lat: 49.0, lon: 2.5  } },
];

describe('HeatmapLayer', () => {
  it('creates a heatLayer with weighted dep/arr endpoint points', () => {
    heatCtor.mockClear();
    render(<HeatmapLayer mapRef={{ current: mockMap }} routes={ROUTES} />);
    expect(heatCtor).toHaveBeenCalled();
    const points = heatCtor.mock.calls[0][0];
    // 2 routes * 2 endpoints = 4 points
    expect(points.length).toBe(4);
    // Each point is [lat, lon, weight]
    expect(points[0]).toHaveLength(3);
    expect(typeof points[0][2]).toBe('number');
  });

  it('renders nothing in React tree', () => {
    const { container } = render(<HeatmapLayer mapRef={{ current: mockMap }} routes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not create heatLayer when routes is empty', () => {
    heatCtor.mockClear();
    render(<HeatmapLayer mapRef={{ current: mockMap }} routes={[]} />);
    expect(heatCtor).not.toHaveBeenCalled();
  });

  it('removes the previous layer on routes update', () => {
    heatCtor.mockClear();
    mockHeatLayer.remove.mockClear();
    const { rerender } = render(<HeatmapLayer mapRef={{ current: mockMap }} routes={ROUTES} />);
    rerender(<HeatmapLayer mapRef={{ current: mockMap }} routes={[ROUTES[0]]} />);
    expect(mockHeatLayer.remove).toHaveBeenCalled();
  });
});

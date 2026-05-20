import { describe, it, expect } from 'vitest';
import {
  computeDegree,
  filterByZoom,
  filterRoutes,
  topDestinations,
} from '../computeMapData';

const ROUTES = [
  { dep: { iata: 'LHR' }, arr: { iata: 'JFK' }, airline_count: 5, aircraft_count: 3, last_seen_at: 1779000000000 },
  { dep: { iata: 'LHR' }, arr: { iata: 'CDG' }, airline_count: 4, aircraft_count: 2, last_seen_at: 1779000000000 },
  { dep: { iata: 'LHR' }, arr: { iata: 'JFK' }, airline_count: 2, aircraft_count: 1, last_seen_at: 1779000000000 }, // duplicate pair
  { dep: { iata: 'JFK' }, arr: { iata: 'CDG' }, airline_count: 3, aircraft_count: 2, last_seen_at: 1779000000000 },
  { dep: { iata: 'SFO' }, arr: { iata: 'HND' }, airline_count: 1, aircraft_count: 1, last_seen_at: 1779000000000 },
];

const AIRPORTS = [
  { iata: 'LHR', lat: 51.4, lon: -0.4, name: 'Heathrow',   city: 'London',  country: 'UK' },
  { iata: 'JFK', lat: 40.6, lon: -73.7, name: 'JFK',        city: 'NY',      country: 'US' },
  { iata: 'CDG', lat: 49.0, lon: 2.5,  name: 'Charles de Gaulle', city: 'Paris', country: 'FR' },
  { iata: 'SFO', lat: 37.6, lon: -122.4, name: 'SFO',       city: 'SF',      country: 'US' },
  { iata: 'HND', lat: 35.5, lon: 139.8, name: 'Haneda',    city: 'Tokyo',   country: 'JP' },
];

describe('computeDegree', () => {
  it('counts distinct routes touching each airport', () => {
    const d = computeDegree(ROUTES);
    expect(d.get('LHR')).toBe(3); // 3 routes touch LHR (LHR-JFK x2, LHR-CDG)
    expect(d.get('JFK')).toBe(3); // 2x LHR-JFK + JFK-CDG
    expect(d.get('CDG')).toBe(2);
    expect(d.get('SFO')).toBe(1);
    expect(d.get('HND')).toBe(1);
  });

  it('returns empty Map for empty routes', () => {
    expect(computeDegree([]).size).toBe(0);
  });
});

describe('filterByZoom', () => {
  it('returns top 200 at zoom <= 3', () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ iata: `A${i}`, degree: 500 - i, lat: 0, lon: 0 }));
    expect(filterByZoom(big, 2)).toHaveLength(200);
    expect(filterByZoom(big, 3)).toHaveLength(200);
    expect(filterByZoom(big, 2)[0].iata).toBe('A0'); // highest degree first
  });

  it('returns top 1000 at zoom 4-5', () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ iata: `A${i}`, degree: 2000 - i, lat: 0, lon: 0 }));
    expect(filterByZoom(big, 4)).toHaveLength(1000);
    expect(filterByZoom(big, 5)).toHaveLength(1000);
  });

  it('returns all at zoom >= 6', () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ iata: `A${i}`, degree: 2000 - i, lat: 0, lon: 0 }));
    expect(filterByZoom(big, 6)).toHaveLength(2000);
    expect(filterByZoom(big, 12)).toHaveLength(2000);
  });
});

describe('filterRoutes', () => {
  it('passes through unchanged when no filters set', () => {
    expect(filterRoutes(ROUTES, { airline: null, aircraft: null }).length).toBe(ROUTES.length);
  });

  it('filters by airline when filters.airline is set (server already applied; this is a no-op safety)', () => {
    expect(filterRoutes(ROUTES, { airline: 'BAW', aircraft: null }).length).toBe(ROUTES.length);
  });

  it('drops routes whose endpoints are not in the visible airport set', () => {
    const visible = new Set(['LHR', 'JFK', 'CDG']);
    const out = filterRoutes(ROUTES, { airline: null, aircraft: null }, visible);
    expect(out).toHaveLength(4); // SFO-HND dropped
    expect(out.every(r => visible.has(r.dep.iata) && visible.has(r.arr.iata))).toBe(true);
  });
});

describe('topDestinations', () => {
  it('returns top K destinations from a given origin, sorted by frequency', () => {
    const out = topDestinations(ROUTES, 'LHR', 5);
    expect(out).toEqual([
      { iata: 'JFK', count: 2 },
      { iata: 'CDG', count: 1 },
    ]);
  });

  it('considers both dep and arr direction', () => {
    const out = topDestinations(ROUTES, 'CDG', 5);
    expect(out).toContainEqual({ iata: 'LHR', count: 1 });
    expect(out).toContainEqual({ iata: 'JFK', count: 1 });
  });

  it('caps results at K', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      dep: { iata: 'HUB' }, arr: { iata: `D${i}` },
      airline_count: 1, aircraft_count: 1, last_seen_at: 0,
    }));
    expect(topDestinations(many, 'HUB', 10)).toHaveLength(10);
  });

  it('returns empty array when origin is unknown', () => {
    expect(topDestinations(ROUTES, 'XXX', 5)).toEqual([]);
  });
});

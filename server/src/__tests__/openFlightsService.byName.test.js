'use strict';
const of = require('../services/openFlightsService');

describe('openFlightsService.getAirlineByName', () => {
  it('resolves a common airline name to its record', () => {
    const r = of.getAirlineByName('British Airways');
    expect(r).not.toBeNull();
    expect(r.iata).toBe('BA');
    expect(r.icao).toBe('BAW');
  });

  it('is case-insensitive', () => {
    expect(of.getAirlineByName('british airways')?.iata).toBe('BA');
    expect(of.getAirlineByName('BRITISH AIRWAYS')?.iata).toBe('BA');
  });

  it('tolerates punctuation / dashes', () => {
    expect(of.getAirlineByName('British-Airways')?.iata).toBe('BA');
    expect(of.getAirlineByName('  British  Airways  ')?.iata).toBe('BA');
  });

  it('returns null for unknown names', () => {
    expect(of.getAirlineByName('NonexistentAir')).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(of.getAirlineByName('')).toBeNull();
    expect(of.getAirlineByName(null)).toBeNull();
    expect(of.getAirlineByName(undefined)).toBeNull();
  });
});

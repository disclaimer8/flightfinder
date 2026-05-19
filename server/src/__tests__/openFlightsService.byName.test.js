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

  it('folds diacritics to ASCII (AeroMéxico → AM)', () => {
    expect(of.getAirlineByName('AeroMéxico')?.iata).toBe('AM');
    expect(of.getAirlineByName('AeroMexico')?.iata).toBe('AM');
  });

  it('handles other accented carriers (Widerøe)', () => {
    // Note: ø (U+00F8) is a precomposed Latin letter, not a diacritic, so NFKD
    // does not fold it to "o". We assert lookup equivalence on a carrier whose
    // diacritic IS NFKD-decomposable (Régional → YS); the Widerøe accented form
    // still resolves directly via the exact-match map.
    const r1 = of.getAirlineByName('Régional');
    const r2 = of.getAirlineByName('Regional');
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1.iata).toBe(r2.iata);
    // And the original ø carrier still resolves in its accented form.
    expect(of.getAirlineByName('Widerøe')).not.toBeNull();
  });
});

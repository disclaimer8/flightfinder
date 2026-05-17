'use strict';
const meta = require('../services/seoMetaService');

describe('seoMetaService new resolvers (Phase 1)', () => {
  it('resolves /flights-from/ORK to airport-departures meta', () => {
    const r = meta.resolve('/flights-from/ORK');
    expect(r).toBeTruthy();
    expect(r.kind).toBe('airport-departures');
    expect(r.iata).toBe('ORK');
  });

  it('resolves /flights-to/lhr (case-insensitive) to airport-arrivals', () => {
    const r = meta.resolve('/flights-to/lhr');
    expect(r).toBeTruthy();
    expect(r.kind).toBe('airport-arrivals');
    expect(r.iata).toBe('LHR');
  });

  it('resolves /airline/EI/from/ORK to airline-airport', () => {
    const r = meta.resolve('/airline/EI/from/ORK');
    expect(r).toBeTruthy();
    expect(r.kind).toBe('airline-airport');
    expect(r.airlineIata).toBe('EI');
    expect(r.airportIata).toBe('ORK');
  });

  // NOTE on rejection assertions: seoMetaService.resolve() never returns
  // a falsy value — unmatched paths fall through to notFoundMeta() (truthy,
  // kind:'not-found'). So "rejection" means the new kind is NOT applied.
  it('rejects malformed IATA on /flights-from', () => {
    expect(meta.resolve('/flights-from/AB').kind).not.toBe('airport-departures');   // 2 chars too short
    expect(meta.resolve('/flights-from/1234').kind).not.toBe('airport-departures'); // 4 chars too long
  });

  it('rejects malformed IATA on /flights-to', () => {
    expect(meta.resolve('/flights-to/AB').kind).not.toBe('airport-arrivals');
    expect(meta.resolve('/flights-to/12345').kind).not.toBe('airport-arrivals');
  });

  it('rejects malformed inputs on /airline/:iata/from/:iata', () => {
    expect(meta.resolve('/airline/EI/from/AB').kind).not.toBe('airline-airport');     // 2-char airport
    expect(meta.resolve('/airline/ABCD/from/ORK').kind).not.toBe('airline-airport');  // 4-char airline
  });

  it('does NOT change existing /airline/:iata behavior (still kind:airline)', () => {
    // Confirms our resolver addition doesn't break the existing bAirline page.
    // The actual kind is 'airline' (not 'airline-network'), per the
    // coexistence strategy: dispatcher will pick jonty-or-bAirline at render time.
    const r = meta.resolve('/airline/EI');
    expect(r).toBeTruthy();
    expect(r.kind).toBe('airline');
  });
});

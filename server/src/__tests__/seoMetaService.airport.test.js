'use strict';
const meta = require('../services/seoMetaService');

describe('seoMetaService new resolvers (Phase 1)', () => {
  it('resolves /flights-from/ORK to full airport-departures meta', () => {
    const r = meta.resolve('/flights-from/ORK');
    expect(r).toBeTruthy();
    expect(r.kind).toBe('airport-departures');
    expect(r.iata).toBe('ORK');
    // Full-meta contract: title/description/canonical/h1/robots all set so
    // seoMetaService.inject() produces a clean shell without falling back to
    // the home page's title (which would dedupe the page in Search Console).
    expect(typeof r.title).toBe('string');
    expect(r.title).toMatch(/Flights from .*ORK/);
    expect(r.title).toMatch(/FlightFinder/);
    expect(typeof r.description).toBe('string');
    expect(r.description.length).toBeGreaterThan(0);
    expect(r.canonical).toBe('https://himaxym.com/flights-from/ork');
    expect(r.h1).toMatch(/Flights from .*\(ORK\)/);
    expect(r.robots).toBe('index, follow');
  });

  it('resolves /flights-to/lhr (case-insensitive) to full airport-arrivals meta', () => {
    const r = meta.resolve('/flights-to/lhr');
    expect(r).toBeTruthy();
    expect(r.kind).toBe('airport-arrivals');
    expect(r.iata).toBe('LHR');
    expect(typeof r.title).toBe('string');
    expect(r.title).toMatch(/Flights to .*LHR/);
    expect(typeof r.description).toBe('string');
    expect(r.canonical).toBe('https://himaxym.com/flights-to/lhr');
    expect(r.h1).toMatch(/Flights to .*\(LHR\)/);
    expect(r.robots).toBe('index, follow');
  });

  it('resolves /airline/EI/from/ORK to full airline-airport meta', () => {
    const r = meta.resolve('/airline/EI/from/ORK');
    expect(r).toBeTruthy();
    expect(r.kind).toBe('airline-airport');
    expect(r.airlineIata).toBe('EI');
    expect(r.airportIata).toBe('ORK');
    expect(typeof r.title).toBe('string');
    expect(r.title).toMatch(/flights from .*ORK/);
    expect(typeof r.description).toBe('string');
    expect(r.canonical).toBe('https://himaxym.com/airline/ei/from/ork');
    expect(r.h1).toMatch(/flights from .*\(ORK\)/);
    expect(r.robots).toBe('index, follow');
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

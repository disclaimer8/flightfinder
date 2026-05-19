'use strict';
const { parsePriceEur, firstMarketingCarrier } = require('../services/gfPriceParsing');

describe('parsePriceEur', () => {
  it('parses €296 → 296', () => {
    expect(parsePriceEur('€296')).toBe(296);
  });
  it('parses €1,234 → 1234', () => {
    expect(parsePriceEur('€1,234')).toBe(1234);
  });
  it('parses €296.50 → 296.5', () => {
    expect(parsePriceEur('€296.50')).toBe(296.5);
  });
  it('returns null for non-EUR (USD, GBP, ...)', () => {
    expect(parsePriceEur('$296')).toBeNull();
    expect(parsePriceEur('£296')).toBeNull();
    expect(parsePriceEur('296')).toBeNull();
  });
  it('returns null for empty / nullish / unparseable', () => {
    expect(parsePriceEur(null)).toBeNull();
    expect(parsePriceEur('')).toBeNull();
    expect(parsePriceEur('€')).toBeNull();
    expect(parsePriceEur('€abc')).toBeNull();
  });
});

describe('firstMarketingCarrier', () => {
  const knownAirlines = new Set([
    'british airways', 'american airlines', 'american', 'finnair', 'iberia',
    'vueling', 'jetblue', 'air france', 'delta', 'klm', 'level', 'westjet',
    'icelandair', 'virgin atlantic',
  ].map(s => s.toLowerCase()));
  const isKnown = (n) => knownAirlines.has(String(n || '').toLowerCase().trim());

  it('returns single name as-is', () => {
    expect(firstMarketingCarrier('JetBlue', isKnown)).toBe('JetBlue');
    expect(firstMarketingCarrier('Icelandair', isKnown)).toBe('Icelandair');
    expect(firstMarketingCarrier('British Airways', isKnown)).toBe('British Airways');
  });
  it('splits comma-separated, takes first', () => {
    expect(firstMarketingCarrier('Vueling, LEVEL', isKnown)).toBe('Vueling');
  });
  it('splits concatenated CamelCase using dictionary', () => {
    expect(firstMarketingCarrier('AmericanFinnair, British Airways, Iberia', isKnown))
      .toBe('American');
    expect(firstMarketingCarrier('Virgin AtlanticAir France, Delta, KLM', isKnown))
      .toBe('Virgin Atlantic');
    expect(firstMarketingCarrier('British AirwaysFinnair, American, Iberia', isKnown))
      .toBe('British Airways');
  });
  it('returns full first token when no concatenation matches', () => {
    expect(firstMarketingCarrier('JetBlue', isKnown)).toBe('JetBlue');
  });
  it('returns null/empty input as null', () => {
    expect(firstMarketingCarrier(null, isKnown)).toBeNull();
    expect(firstMarketingCarrier('', isKnown)).toBeNull();
    expect(firstMarketingCarrier('   ', isKnown)).toBeNull();
  });
});

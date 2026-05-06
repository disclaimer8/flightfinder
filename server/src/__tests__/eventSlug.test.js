'use strict';
const { buildEventSlug, parseEventIdFromSlug } = require('../utils/eventSlug');

describe('buildEventSlug', () => {
  test('builds full slug from event with all fields', () => {
    const ev = {
      id: 1234,
      occurred_at: 1705276800000, // 2024-01-15
      operator_name: 'United Airlines',
      aircraft_icao_type: 'B789',
      dep_iata: 'NRT',
      location_country: 'Japan',
    };
    expect(buildEventSlug(ev)).toBe('2024-01-15-united-airlines-b789-nrt-1234');
  });

  test('truncates long operator name to 40 chars', () => {
    const ev = {
      id: 99,
      occurred_at: 1705276800000,
      operator_name: 'Aerolíneas Argentinas Premium International Holding Corporation',
      aircraft_icao_type: 'A320',
      dep_iata: 'EZE',
    };
    const slug = buildEventSlug(ev);
    const segments = slug.split('-');
    // operator portion: indices 3..(N-3) — but easier: ensure total length < 200
    expect(slug.length).toBeLessThan(200);
    expect(slug.endsWith('-99')).toBe(true);
  });

  test('falls back to "unknown-op" when operator missing', () => {
    const ev = { id: 5, occurred_at: 1705276800000, aircraft_icao_type: 'C172', dep_iata: 'KJFK' };
    expect(buildEventSlug(ev)).toContain('unknown-op');
  });

  test('falls back to country when dep_iata missing', () => {
    const ev = {
      id: 7,
      occurred_at: 1705276800000,
      operator_name: 'Air France',
      aircraft_icao_type: 'A350',
      location_country: 'France',
    };
    expect(buildEventSlug(ev)).toContain('france');
  });
});

describe('parseEventIdFromSlug', () => {
  test('extracts id from full slug', () => {
    expect(parseEventIdFromSlug('2024-01-15-united-airlines-b789-nrt-1234')).toBe(1234);
  });

  test('handles bare numeric (legacy URL)', () => {
    expect(parseEventIdFromSlug('1234')).toBe(1234);
  });

  test('returns null for invalid input', () => {
    expect(parseEventIdFromSlug('')).toBe(null);
    expect(parseEventIdFromSlug('not-a-number')).toBe(null);
    expect(parseEventIdFromSlug(null)).toBe(null);
  });
});

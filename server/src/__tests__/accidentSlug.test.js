'use strict';
const { slugify, buildAccidentSlugCandidate, MONTH_MAP } = require('../utils/accidentSlug');

describe('slugify', () => {
  it('lowercases + replaces spaces with hyphens', () => {
    expect(slugify('Fokker 50', 30)).toBe('fokker-50');
  });
  it('strips diacritics', () => {
    expect(slugify('São Paulo', 30)).toBe('sao-paulo');
  });
  it('strips trailing/leading hyphens', () => {
    expect(slugify('--abc--', 30)).toBe('abc');
  });
  it('caps to maxLen', () => {
    expect(slugify('Cessna 208B Grand Caravan', 20)).toBe('cessna-208b-grand-ca');
  });
  it('collapses non-alphanum runs', () => {
    expect(slugify('B-737/800 (WL)', 30)).toBe('b-737-800-wl');
  });
  it('returns empty string when only non-ASCII', () => {
    expect(slugify('日本', 30)).toBe('');
  });
});

describe('buildAccidentSlugCandidate', () => {
  it('full date + all parts', () => {
    expect(buildAccidentSlugCandidate({
      normalized_date: '2024-10-15',
      aircraft_model: 'Fokker 50',
      operator: 'Rudufu Air',
      location: 'Nairobi-Wilson Airport (WIL/HKNW)',
    })).toBe('2024-10-15-fokker-50-rudufu-air-nairobi-wilson-airport-wi');
  });
  it('partial xx date', () => {
    expect(buildAccidentSlugCandidate({
      normalized_date: 'xx Oct 2024',
      aircraft_model: 'Fokker 50',
      operator: 'Rudufu Air',
      location: 'Nairobi',
    })).toBe('2024-10-xx-fokker-50-rudufu-air-nairobi');
  });
  it('missing operator/location skipped', () => {
    expect(buildAccidentSlugCandidate({
      normalized_date: '2026-05-08',
      aircraft_model: 'Airbus A321',
      operator: '',
      location: null,
    })).toBe('2026-05-08-airbus-a321');
  });
  it('unknown date sentinel', () => {
    expect(buildAccidentSlugCandidate({
      normalized_date: 'American Airlines Flight 11',
      aircraft_model: 'Boeing 767',
      operator: 'American',
      location: 'New York',
    })).toBe('unknown-date-boeing-767-american-new-york');
  });
  it('total length capped at 80', () => {
    const s = buildAccidentSlugCandidate({
      normalized_date: '2024-10-15',
      aircraft_model: 'Very-Long-Aircraft-Name-Indeed',
      operator: 'A Very Long Operator Name',
      location: 'A Very Long Airport Name With Codes (ABC/DEFG)',
    });
    expect(s.length).toBeLessThanOrEqual(80);
  });
});

describe('MONTH_MAP', () => {
  it('maps short month names to 2-digit numerics', () => {
    expect(MONTH_MAP.Jan).toBe('01');
    expect(MONTH_MAP.Oct).toBe('10');
    expect(MONTH_MAP.Dec).toBe('12');
  });
});

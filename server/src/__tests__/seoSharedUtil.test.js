'use strict';
const { SITE, escapeHtml, routeSlug, routeLabel, airportLabel } = require('../services/seoSharedUtil');

describe('seoSharedUtil', () => {
  it('SITE is the production canonical host', () => {
    expect(SITE).toBe('https://himaxym.com');
  });

  describe('escapeHtml', () => {
    it('escapes the five HTML-significant characters', () => {
      expect(escapeHtml(`<a href="?x&y='">b</a>`)).toBe('&lt;a href=&quot;?x&amp;y=&#39;&quot;&gt;b&lt;/a&gt;');
    });
    it('returns empty string for null and undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });
    it('stringifies non-strings (numbers, booleans)', () => {
      expect(escapeHtml(42)).toBe('42');
      expect(escapeHtml(true)).toBe('true');
    });
  });

  describe('routeSlug', () => {
    it('lowercases both inputs and joins with -', () => {
      expect(routeSlug('ORD', 'LHR')).toBe('ord-lhr');
    });
    it('handles already-lowercase input', () => {
      expect(routeSlug('ord', 'lhr')).toBe('ord-lhr');
    });
    it('handles mixed case', () => {
      expect(routeSlug('Ord', 'lHr')).toBe('ord-lhr');
    });
  });

  describe('routeLabel', () => {
    it('singular for 1', () => {
      expect(routeLabel(1)).toBe('1 route');
    });
    it('plural for 0', () => {
      expect(routeLabel(0)).toBe('0 routes');
    });
    it('plural for N > 1', () => {
      expect(routeLabel(42)).toBe('42 routes');
    });
  });

  describe('airportLabel', () => {
    it('singular for 1', () => {
      expect(airportLabel(1)).toBe('1 airport');
    });
    it('plural for 0', () => {
      expect(airportLabel(0)).toBe('0 airports');
    });
    it('plural for N > 1', () => {
      expect(airportLabel(15)).toBe('15 airports');
    });
  });
});

'use strict';
const { SITE, escapeHtml } = require('../services/seoSharedUtil');

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
});

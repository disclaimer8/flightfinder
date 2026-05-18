'use strict';

const script = require('../../scripts/submit-indexnow');

describe('submit-indexnow URL set builder', () => {
  test('buildUrlSet returns array of absolute https URLs', () => {
    const urls = script.buildUrlSet(['/foo', '/bar']);
    expect(urls).toEqual([
      'https://himaxym.com/foo',
      'https://himaxym.com/bar',
    ]);
  });

  test('buildUrlSet lowercases paths to match sitemap canonical form', () => {
    const urls = script.buildUrlSet(['/Airline/BA', '/COUNTRY/US']);
    expect(urls).toEqual([
      'https://himaxym.com/airline/ba',
      'https://himaxym.com/country/us',
    ]);
  });

  test('buildUrlSet dedupes identical entries', () => {
    const urls = script.buildUrlSet(['/foo', '/foo', '/FOO']);
    expect(urls).toEqual(['https://himaxym.com/foo']);
  });

  test('buildUrlSet excludes paths containing fragments or query strings', () => {
    const urls = script.buildUrlSet(['/foo', '/bar?x=1', '/baz#section']);
    expect(urls).toEqual(['https://himaxym.com/foo']);
  });

  test('buildUrlSet rejects empty input', () => {
    expect(script.buildUrlSet([])).toEqual([]);
  });
});

describe('submit-indexnow indexable filter', () => {
  let script, resolveMock;
  beforeEach(() => {
    jest.resetModules();
    resolveMock = jest.fn();
    jest.doMock('../services/seoMetaService', () => ({ resolve: resolveMock }));
    script = require('../../scripts/submit-indexnow');
  });

  test('filterIndexable excludes paths where resolver returns noindex', () => {
    resolveMock.mockImplementation((p) => {
      if (p === '/private') return { robots: 'noindex, follow' };
      return { robots: 'index, follow' };
    });
    const result = script.filterIndexable(['/public', '/private', '/also-public']);
    expect(result).toEqual(['/public', '/also-public']);
  });

  test('filterIndexable keeps paths where resolver returns null (unknown)', () => {
    resolveMock.mockReturnValue(null);
    const result = script.filterIndexable(['/unknown']);
    expect(result).toEqual(['/unknown']);
  });

  test('filterIndexable handles resolver throwing', () => {
    resolveMock.mockImplementation(() => { throw new Error('jonty.db not present'); });
    const result = script.filterIndexable(['/some-path']);
    expect(result).toEqual(['/some-path']);
  });
});

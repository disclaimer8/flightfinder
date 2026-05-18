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

describe('submit-indexnow classifyResponse', () => {
  const script = require('../../scripts/submit-indexnow');

  test('200 → ok=true exit=0', () => {
    const c = script.classifyResponse(200);
    expect(c).toEqual({ ok: true, recoverable: true, exitCode: 0, label: 'ok' });
  });
  test('202 → ok=true exit=0', () => {
    expect(script.classifyResponse(202).exitCode).toBe(0);
  });
  test('422 (duplicate) → ok=false recoverable=true exit=0', () => {
    const c = script.classifyResponse(422);
    expect(c).toEqual({ ok: false, recoverable: true, exitCode: 0, label: 'duplicate' });
  });
  test('429 (rate limit) → recoverable exit=0', () => {
    expect(script.classifyResponse(429).exitCode).toBe(0);
  });
  test('401 (auth) → unrecoverable exit=1', () => {
    expect(script.classifyResponse(401).exitCode).toBe(1);
  });
  test('403 (verification race) → recoverable exit=0', () => {
    const c = script.classifyResponse(403);
    expect(c).toEqual({ ok: false, recoverable: true, exitCode: 0, label: 'verification-pending' });
  });
  test('400 → unrecoverable exit=1', () => {
    expect(script.classifyResponse(400).exitCode).toBe(1);
  });
  test('500 → recoverable exit=0', () => {
    expect(script.classifyResponse(500).exitCode).toBe(0);
  });
  test('503 → recoverable exit=0', () => {
    expect(script.classifyResponse(503).exitCode).toBe(0);
  });
});

describe('submit-indexnow submitUrls', () => {
  let script;
  beforeEach(() => {
    jest.resetModules();
    script = require('../../scripts/submit-indexnow');
  });

  test('POSTs correct payload structure', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 200, text: async () => '' });
    const result = await script.submitUrls(
      ['https://himaxym.com/a', 'https://himaxym.com/b'],
      'abc123',
      { fetch: fetchMock }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      host: 'himaxym.com',
      key: 'abc123',
      keyLocation: 'https://himaxym.com/abc123.txt',
      urlList: ['https://himaxym.com/a', 'https://himaxym.com/b'],
    });
    expect(result.status).toBe(200);
  });

  test('rejects empty urlList without calling fetch', async () => {
    const fetchMock = jest.fn();
    await expect(script.submitUrls([], 'abc123', { fetch: fetchMock }))
      .rejects.toThrow(/empty/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects missing key without calling fetch', async () => {
    const fetchMock = jest.fn();
    await expect(script.submitUrls(['https://himaxym.com/a'], '', { fetch: fetchMock }))
      .rejects.toThrow(/key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('submit-indexnow shouldSubmitOnDeploy', () => {
  const script = require('../../scripts/submit-indexnow');

  test('returns true when SEO service file changed', () => {
    const changed = ['server/src/services/seoMetaService.js', 'README.md'];
    expect(script.shouldSubmitOnDeploy(changed)).toBe(true);
  });

  test('returns true when sync-jonty.js changed', () => {
    expect(script.shouldSubmitOnDeploy(['server/scripts/sync-jonty.js'])).toBe(true);
  });

  test('returns true when alliances.json changed', () => {
    expect(script.shouldSubmitOnDeploy(['server/src/data/alliances.json'])).toBe(true);
  });

  test('returns true when seo route changed', () => {
    expect(script.shouldSubmitOnDeploy(['server/src/routes/seo.js'])).toBe(true);
  });

  test('returns false when only docs changed', () => {
    const changed = ['README.md', 'docs/superpowers/specs/foo.md'];
    expect(script.shouldSubmitOnDeploy(changed)).toBe(false);
  });

  test('returns false on empty diff', () => {
    expect(script.shouldSubmitOnDeploy([])).toBe(false);
  });

  test('returns true for any *Builder.js file in services', () => {
    expect(script.shouldSubmitOnDeploy(['server/src/services/countryBuilder.js'])).toBe(true);
  });
});

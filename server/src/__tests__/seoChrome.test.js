const chrome = require('../services/seoChrome');

describe('seoChrome module shell', () => {
  it('exports applyChrome', () => {
    expect(typeof chrome.applyChrome).toBe('function');
  });

  it('applyChrome returns null when innerHtml is null', () => {
    expect(chrome.applyChrome({ kind: 'aircraft' }, null, {})).toBeNull();
  });

  it('applyChrome returns innerHtml unchanged when meta is null (defensive)', () => {
    expect(chrome.applyChrome(null, '<p>inner</p>', {})).toBe('<p>inner</p>');
  });
});

describe('seoChrome._renderSiteNav', () => {
  const { _renderSiteNav } = chrome._internal;

  it('renders <nav> with all 6 site links', () => {
    const html = _renderSiteNav();
    expect(html).toMatch(/<nav class="seo-nav"/);
    expect(html).toMatch(/href="\/"/);
    expect(html).toMatch(/href="\/by-aircraft"/);
    expect(html).toMatch(/href="\/map"/);
    expect(html).toMatch(/href="\/safety\/global"/);
    expect(html).toMatch(/href="\/about"/);
    expect(html).toMatch(/href="\/pricing"/);
  });

  it('returns same string on subsequent calls (cached const)', () => {
    expect(_renderSiteNav()).toBe(_renderSiteNav());
  });
});

describe('seoChrome._safeChrome', () => {
  const { _safeChrome } = chrome._internal;

  it('returns fn() result on success', () => {
    expect(_safeChrome(() => 'hello')).toBe('hello');
  });

  it('returns fallback on throw', () => {
    expect(_safeChrome(() => { throw new Error('boom'); }, 'fallback')).toBe('fallback');
  });

  it('default fallback is empty string', () => {
    expect(_safeChrome(() => { throw new Error('boom'); })).toBe('');
  });

  it('logs warn on throw', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    _safeChrome(() => { throw new Error('boom'); });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('seoChrome'));
    warn.mockRestore();
  });
});

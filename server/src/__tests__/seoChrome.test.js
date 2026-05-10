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

describe('seoChrome._renderBreadcrumbs', () => {
  const { _renderBreadcrumbs } = chrome._internal;

  it('returns "" for home kind', () => {
    expect(_renderBreadcrumbs({ kind: 'home' })).toBe('');
  });

  it('returns "" for not-found kind', () => {
    expect(_renderBreadcrumbs({ kind: 'not-found' })).toBe('');
  });

  it('renders Aircraft family breadcrumbs', () => {
    const html = _renderBreadcrumbs({
      kind: 'aircraft',
      slug: 'boeing-787',
      aircraftLabel: 'Boeing 787',
    });
    expect(html).toMatch(/<nav class="breadcrumbs"/);
    expect(html).toMatch(/href="\/">Home</);
    expect(html).toMatch(/href="\/by-aircraft">Aircraft</);
    expect(html).toMatch(/Boeing 787/);
  });

  it('renders Aircraft variant breadcrumbs with all 4 levels', () => {
    const html = _renderBreadcrumbs({
      kind: 'aircraft-variant',
      variant: { familySlug: 'boeing-787', shortName: '787-9' },
      family: { name: 'Boeing 787', slug: 'boeing-787' },
    });
    expect(html).toMatch(/href="\/aircraft\/boeing-787">Boeing 787</);
    expect(html).toMatch(/787-9/);
  });

  it('renders aircraft subpage breadcrumbs (operators)', () => {
    const html = _renderBreadcrumbs({
      kind: 'aircraft-airlines',
      slug: 'boeing-787',
      aircraftLabel: 'Boeing 787',
    });
    expect(html).toMatch(/Operators/);
  });

  it('renders route breadcrumbs', () => {
    const html = _renderBreadcrumbs({
      kind: 'route',
      fromIata: 'JFK',
      toIata: 'LHR',
    });
    expect(html).toMatch(/JFK/);
    expect(html).toMatch(/LHR/);
  });

  it('escapes XSS in slug/label', () => {
    const html = _renderBreadcrumbs({
      kind: 'aircraft',
      slug: '<script>',
      aircraftLabel: '<img>',
    });
    expect(html).not.toMatch(/<script>/);
    expect(html).not.toMatch(/<img>/);
    // aircraftLabel wins over slug per impl; assert it's escaped
    expect(html).toMatch(/&lt;img&gt;/);
  });

  it('falls back to Home › <kind> for unknown kind', () => {
    const html = _renderBreadcrumbs({ kind: 'mystery' });
    expect(html).toMatch(/href="\/">Home</);
    expect(html).toMatch(/mystery/);
  });
});

describe('seoChrome._renderFooter', () => {
  const { _renderFooter } = chrome._internal;

  function mockDb(overrides = {}) {
    return {
      getTopRoutesByObservedFrequency: jest.fn(() => [
        { from: 'JFK', to: 'LHR', count: 100 },
        { from: 'LAX', to: 'NRT', count: 80 },
      ]),
      ...overrides,
    };
  }

  beforeEach(() => {
    chrome._internal._invalidateFooterCache();
  });

  it('renders all 4 footer sections', () => {
    const html = _renderFooter(mockDb());
    expect(html).toMatch(/<footer class="seo-footer"/);
    expect(html).toMatch(/<h4>Aircraft families<\/h4>/);
    expect(html).toMatch(/<h4>Popular routes<\/h4>/);
    expect(html).toMatch(/<h4>Safety<\/h4>/);
    expect(html).toMatch(/<h4>About<\/h4>/);
  });

  it('renders top routes from db helper', () => {
    const html = _renderFooter(mockDb());
    expect(html).toMatch(/href="\/routes\/jfk-lhr"/);
    expect(html).toMatch(/JFK–LHR/);
  });

  it('renders all aircraft families with links', () => {
    const html = _renderFooter(mockDb());
    expect(html).toMatch(/href="\/aircraft\/boeing-737"/);
    expect(html).toMatch(/href="\/aircraft\/airbus-a320"/);
  });

  it('renders safety + about links', () => {
    const html = _renderFooter(mockDb());
    expect(html).toMatch(/href="\/safety\/global"/);
    expect(html).toMatch(/href="\/safety\/feed"/);
    expect(html).toMatch(/href="\/about"/);
    expect(html).toMatch(/href="\/pricing"/);
  });

  it('routes section empty if helper throws — other sections render', () => {
    const db = mockDb({
      getTopRoutesByObservedFrequency: jest.fn(() => { throw new Error('db down'); }),
    });
    const html = _renderFooter(db);
    expect(html).toMatch(/<h4>Aircraft families<\/h4>/);
    expect(html).toMatch(/<h4>Safety<\/h4>/);
    expect(html).toMatch(/<h4>Popular routes<\/h4>/);
  });

  it('caches result for 60 seconds (same db call count)', () => {
    const db = mockDb();
    _renderFooter(db);
    _renderFooter(db);
    _renderFooter(db);
    expect(db.getTopRoutesByObservedFrequency).toHaveBeenCalledTimes(1);
  });
});

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

describe('seoChrome._renderCrossRefs', () => {
  const { _renderCrossRefs } = chrome._internal;

  it('returns "" for unknown kind', () => {
    expect(_renderCrossRefs({ kind: 'home' }, {})).toBe('');
    expect(_renderCrossRefs({ kind: 'about' }, {})).toBe('');
    expect(_renderCrossRefs({ kind: 'not-found' }, {})).toBe('');
  });

  describe('aircraft-variant kind', () => {
    it('renders sibling variants excluding self', () => {
      jest.resetModules();
      jest.doMock('../models/aircraftVariants', () => ({
        getVariantsByFamilySlug: () => [
          { icao: 'B788', familySlug: 'boeing-787', slug: '787-8', shortName: '787-8' },
          { icao: 'B789', familySlug: 'boeing-787', slug: '787-9', shortName: '787-9' },
          { icao: 'B78X', familySlug: 'boeing-787', slug: '787-10', shortName: '787-10' },
        ],
      }));
      const freshChrome = require('../services/seoChrome');
      const html = freshChrome._internal._renderCrossRefs({
        kind: 'aircraft-variant',
        variant: { icao: 'B789', familySlug: 'boeing-787' },
      }, {});
      expect(html).toMatch(/<aside class="cross-refs"/);
      expect(html).toMatch(/Other variants/);
      expect(html).toMatch(/787-8/);
      expect(html).toMatch(/787-10/);
      expect(html).not.toMatch(/787-9/);  // excluded self
      jest.dontMock('../models/aircraftVariants');
    });

    it('returns "" when variant is the only one in family', () => {
      jest.resetModules();
      jest.doMock('../models/aircraftVariants', () => ({
        getVariantsByFamilySlug: () => [{ icao: 'B789', familySlug: 'boeing-787', slug: '787-9', shortName: '787-9' }],
      }));
      const freshChrome = require('../services/seoChrome');
      const html = freshChrome._internal._renderCrossRefs({
        kind: 'aircraft-variant',
        variant: { icao: 'B789', familySlug: 'boeing-787' },
      }, {});
      expect(html).toBe('');
      jest.dontMock('../models/aircraftVariants');
    });
  });

  describe('aircraft (family) kind', () => {
    it('renders other families by same manufacturer (excluding self)', () => {
      jest.resetModules();
      jest.doMock('../models/aircraftFamilies', () => ({
        getFamilyList: () => [
          { slug: 'boeing-737', label: 'Boeing 737', manufacturer: 'Boeing' },
          { slug: 'boeing-747', label: 'Boeing 747', manufacturer: 'Boeing' },
          { slug: 'boeing-787', label: 'Boeing 787', manufacturer: 'Boeing' },
          { slug: 'airbus-a320', label: 'Airbus A320', manufacturer: 'Airbus' },
        ],
      }));
      const freshChrome = require('../services/seoChrome');
      const html = freshChrome._internal._renderCrossRefs({
        kind: 'aircraft',
        slug: 'boeing-787',
        family: { manufacturer: 'Boeing' },
      }, {});
      expect(html).toMatch(/Other Boeing/);
      expect(html).toMatch(/Boeing 737/);
      expect(html).toMatch(/Boeing 747/);
      expect(html).not.toMatch(/Boeing 787/);  // self excluded
      expect(html).not.toMatch(/Airbus/);  // different manufacturer
      jest.dontMock('../models/aircraftFamilies');
    });

    it('returns "" when no other families share manufacturer', () => {
      jest.resetModules();
      jest.doMock('../models/aircraftFamilies', () => ({
        getFamilyList: () => [
          { slug: 'atr-42-72', label: 'ATR 42/72', manufacturer: 'ATR' },
          { slug: 'boeing-787', label: 'Boeing 787', manufacturer: 'Boeing' },
        ],
      }));
      const freshChrome = require('../services/seoChrome');
      const html = freshChrome._internal._renderCrossRefs({
        kind: 'aircraft',
        slug: 'atr-42-72',
        family: { manufacturer: 'ATR' },
      }, {});
      expect(html).toBe('');
      jest.dontMock('../models/aircraftFamilies');
    });
  });

  describe('aircraft subpage kinds', () => {
    it('renders "More about {family}" for aircraft-airlines', () => {
      const html = _renderCrossRefs({
        kind: 'aircraft-airlines',
        slug: 'boeing-787',
        aircraftLabel: 'Boeing 787',
      }, {});
      expect(html).toMatch(/More about Boeing 787/);
      expect(html).toMatch(/href="\/aircraft\/boeing-787">Overview</);
      expect(html).toMatch(/href="\/aircraft\/boeing-787\/routes"/);
      expect(html).toMatch(/href="\/aircraft\/boeing-787\/safety"/);
      expect(html).toMatch(/href="\/aircraft\/boeing-787\/specs"/);
      expect(html).not.toMatch(/href="\/aircraft\/boeing-787\/airlines"/);
    });

    it('renders for aircraft-safety with self excluded', () => {
      const html = _renderCrossRefs({
        kind: 'aircraft-safety',
        slug: 'boeing-787',
        aircraftLabel: 'Boeing 787',
      }, {});
      expect(html).toMatch(/href="\/aircraft\/boeing-787\/airlines"/);
      expect(html).toMatch(/href="\/aircraft\/boeing-787\/routes"/);
      expect(html).not.toMatch(/href="\/aircraft\/boeing-787\/safety"/);
    });
  });
});

describe('seoChrome._renderCrossRefs route kinds', () => {
  const { _renderCrossRefs } = chrome._internal;

  function mockRouteDb(fromRoutes, toRoutes) {
    return {
      getTopRoutesFromAirport: jest.fn(() => fromRoutes),
      getTopRoutesToAirport: jest.fn(() => toRoutes),
    };
  }

  it('renders both "from" and "to" sections for route kind', () => {
    const html = _renderCrossRefs(
      { kind: 'route', fromIata: 'JFK', toIata: 'LHR' },
      mockRouteDb(
        [{ from: 'JFK', to: 'CDG', count: 3 }, { from: 'JFK', to: 'FRA', count: 2 }],
        [{ from: 'BOS', to: 'LHR', count: 4 }, { from: 'ORD', to: 'LHR', count: 3 }],
      ),
    );
    expect(html).toMatch(/Other routes from JFK/);
    expect(html).toMatch(/href="\/routes\/jfk-cdg"/);
    expect(html).toMatch(/Other routes to LHR/);
    expect(html).toMatch(/href="\/routes\/bos-lhr"/);
  });

  it('skips self-route from "from" list', () => {
    const html = _renderCrossRefs(
      { kind: 'route', fromIata: 'JFK', toIata: 'LHR' },
      mockRouteDb(
        [
          { from: 'JFK', to: 'LHR', count: 5 },
          { from: 'JFK', to: 'CDG', count: 3 },
        ],
        [],
      ),
    );
    expect(html).not.toMatch(/href="\/routes\/jfk-lhr"/);
    expect(html).toMatch(/href="\/routes\/jfk-cdg"/);
  });

  it('returns only "to" section if "from" data is empty', () => {
    const html = _renderCrossRefs(
      { kind: 'route', fromIata: 'JFK', toIata: 'LHR' },
      mockRouteDb([], [{ from: 'BOS', to: 'LHR', count: 4 }]),
    );
    expect(html).not.toMatch(/Other routes from JFK/);
    expect(html).toMatch(/Other routes to LHR/);
  });

  it('returns "" when both "from" and "to" data are empty', () => {
    const html = _renderCrossRefs(
      { kind: 'route', fromIata: 'JFK', toIata: 'LHR' },
      mockRouteDb([], []),
    );
    expect(html).toBe('');
  });

  it('renders aircraft-route cross-refs', () => {
    const html = _renderCrossRefs(
      { kind: 'aircraft-route', fromIata: 'JFK', toIata: 'LHR', slug: 'boeing-787', aircraftLabel: 'Boeing 787' },
      {},
    );
    expect(html).toMatch(/href="\/routes\/jfk-lhr"/);
    expect(html).toMatch(/href="\/aircraft\/boeing-787"/);
    expect(html).toMatch(/Boeing 787/);
  });
});

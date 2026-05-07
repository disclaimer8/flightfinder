import { describe, test, expect } from 'vitest';
import {
  parseSearchParams,
  serializeSearchParams,
  searchAffectingHash,
  isSearchReady,
  DEFAULTS,
} from '../searchParams';

function urlParams(qs) {
  return new URLSearchParams(qs);
}

describe('parseSearchParams', () => {
  test('empty params returns defaults', () => {
    const v = parseSearchParams(urlParams(''));
    expect(v).toEqual({
      from: '', to: '', date: '', return: '',
      pax: 1, cabin: 'economy', flexDates: false,
      aircraft: [], airlines: [], direct: false,
      sort: 'cheapest', shown: 7,
    });
  });

  test('full happy-path URL parses correctly', () => {
    const v = parseSearchParams(urlParams(
      'from=LHR&to=JFK&date=2026-05-15&return=2026-05-22' +
      '&pax=2&cabin=business&flex_dates=1' +
      '&aircraft=boeing-787,airbus-a380&airlines=BA,VS&direct=1' +
      '&sort=safety&shown=37'
    ));
    expect(v).toEqual({
      from: 'LHR', to: 'JFK', date: '2026-05-15', return: '2026-05-22',
      pax: 2, cabin: 'business', flexDates: true,
      aircraft: ['boeing-787', 'airbus-a380'],
      airlines: ['BA', 'VS'],
      direct: true,
      sort: 'safety', shown: 37,
    });
  });

  test('IATA codes uppercased', () => {
    const v = parseSearchParams(urlParams('from=lhr&to=jfk'));
    expect(v.from).toBe('LHR');
    expect(v.to).toBe('JFK');
  });

  test('pax clamped to 1..9', () => {
    expect(parseSearchParams(urlParams('pax=0')).pax).toBe(1);
    expect(parseSearchParams(urlParams('pax=99')).pax).toBe(9);
    expect(parseSearchParams(urlParams('pax=banana')).pax).toBe(1);
  });

  test('shown defaults to 7 if negative or missing', () => {
    expect(parseSearchParams(urlParams('shown=-5')).shown).toBe(7);
    expect(parseSearchParams(urlParams('shown=37')).shown).toBe(37);
    expect(parseSearchParams(urlParams('')).shown).toBe(7);
  });

  test('unknown sort falls back to cheapest', () => {
    expect(parseSearchParams(urlParams('sort=banana')).sort).toBe('cheapest');
    expect(parseSearchParams(urlParams('sort=fastest')).sort).toBe('fastest');
  });

  test('unknown cabin falls back to economy', () => {
    expect(parseSearchParams(urlParams('cabin=luxury')).cabin).toBe('economy');
  });

  test('aircraft list trims whitespace and drops empties', () => {
    const v = parseSearchParams(urlParams('aircraft=boeing-787, , airbus-a380'));
    expect(v.aircraft).toEqual(['boeing-787', 'airbus-a380']);
  });

  test('airlines list uppercased', () => {
    const v = parseSearchParams(urlParams('airlines=ba,vs'));
    expect(v.airlines).toEqual(['BA', 'VS']);
  });

  test('flex_dates "true" parses as boolean true', () => {
    expect(parseSearchParams(urlParams('flex_dates=true')).flexDates).toBe(true);
  });

  test('direct "true" parses as boolean true', () => {
    expect(parseSearchParams(urlParams('direct=true')).direct).toBe(true);
  });
});

describe('serializeSearchParams', () => {
  test('round-trips a complete state', () => {
    const original = {
      from: 'LHR', to: 'JFK', date: '2026-05-15', return: '2026-05-22',
      pax: 2, cabin: 'business', flexDates: true,
      aircraft: ['boeing-787'], airlines: ['BA'], direct: true,
      sort: 'safety', shown: 37,
    };
    const qs = serializeSearchParams(original);
    const parsed = parseSearchParams(new URLSearchParams(qs));
    expect(parsed).toEqual(original);
  });

  test('omits defaults from query string', () => {
    const minimal = {
      from: 'LHR', to: 'JFK', date: '2026-05-15', return: '',
      pax: 1, cabin: 'economy', flexDates: false,
      aircraft: [], airlines: [], direct: false,
      sort: 'cheapest', shown: 7,
    };
    const qs = serializeSearchParams(minimal);
    expect(qs).toBe('from=LHR&to=JFK&date=2026-05-15');
  });
});

describe('searchAffectingHash', () => {
  const base = {
    from: 'LHR', to: 'JFK', date: '2026-05-15', return: '',
    pax: 1, cabin: 'economy', flexDates: false,
    aircraft: [], airlines: [], direct: false,
    sort: 'cheapest', shown: 7,
  };

  test('changes when from changes', () => {
    expect(searchAffectingHash(base)).not.toBe(searchAffectingHash({ ...base, from: 'CDG' }));
  });

  test('changes when cabin changes', () => {
    expect(searchAffectingHash(base)).not.toBe(searchAffectingHash({ ...base, cabin: 'business' }));
  });

  test('changes when flexDates changes', () => {
    expect(searchAffectingHash(base)).not.toBe(searchAffectingHash({ ...base, flexDates: true }));
  });

  test('does NOT change when filter-only param changes', () => {
    expect(searchAffectingHash(base)).toBe(searchAffectingHash({ ...base, aircraft: ['boeing-787'] }));
    expect(searchAffectingHash(base)).toBe(searchAffectingHash({ ...base, airlines: ['BA'] }));
    expect(searchAffectingHash(base)).toBe(searchAffectingHash({ ...base, direct: true }));
  });

  test('does NOT change when display-only param changes', () => {
    expect(searchAffectingHash(base)).toBe(searchAffectingHash({ ...base, sort: 'safety' }));
    expect(searchAffectingHash(base)).toBe(searchAffectingHash({ ...base, shown: 100 }));
  });
});

describe('isSearchReady', () => {
  test('false without from/to/date', () => {
    expect(isSearchReady({ from: '', to: '', date: '' })).toBe(false);
    expect(isSearchReady({ from: 'LHR', to: '', date: '' })).toBe(false);
    expect(isSearchReady({ from: 'LHR', to: 'JFK', date: '' })).toBe(false);
  });

  test('true with all three', () => {
    expect(isSearchReady({ from: 'LHR', to: 'JFK', date: '2026-05-15' })).toBe(true);
  });
});

describe('DEFAULTS', () => {
  test('matches the parse-empty result', () => {
    const empty = parseSearchParams(new URLSearchParams(''));
    expect(empty).toEqual(DEFAULTS);
  });
});

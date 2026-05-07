// URL search-params contract for /search.
// Single source of truth for parsing, serializing, and classifying the
// 12 params that drive the search page. See spec section 7.

export const DEFAULTS = Object.freeze({
  from: '',
  to: '',
  date: '',
  return: '',
  pax: 1,
  cabin: 'economy',
  flexDates: false,
  aircraft: [],
  airlines: [],
  direct: false,
  sort: 'cheapest',
  shown: 7,
});

const VALID_CABINS = new Set(['economy', 'premium-economy', 'business', 'first']);
const VALID_SORTS  = new Set(['cheapest', 'fastest', 'safety', 'departure-asc', 'departure-desc']);

function asStrList(raw) {
  if (!raw) return [];
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

function asInt(raw, fallback) {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Parse a URLSearchParams instance into the canonical state shape.
 * Always returns a complete object with defaults filled in.
 */
export function parseSearchParams(usp) {
  const get = k => usp.get(k);

  const cabinRaw = get('cabin') || DEFAULTS.cabin;
  const cabin = VALID_CABINS.has(cabinRaw) ? cabinRaw : DEFAULTS.cabin;

  const sortRaw = get('sort') || DEFAULTS.sort;
  const sort = VALID_SORTS.has(sortRaw) ? sortRaw : DEFAULTS.sort;

  const paxRaw = asInt(get('pax'), DEFAULTS.pax);
  const pax = clamp(paxRaw, 1, 9);

  const shownRaw = asInt(get('shown'), DEFAULTS.shown);
  const shown = shownRaw < 0 ? DEFAULTS.shown : shownRaw;

  return {
    from: (get('from') || '').toUpperCase(),
    to:   (get('to')   || '').toUpperCase(),
    date: get('date') || '',
    return: get('return') || '',
    pax,
    cabin,
    flexDates: get('flex_dates') === '1' || get('flex_dates') === 'true',
    aircraft: asStrList(get('aircraft')),
    airlines: asStrList(get('airlines')).map(a => a.toUpperCase()),
    direct: get('direct') === '1' || get('direct') === 'true',
    sort,
    shown,
  };
}

/**
 * Serialize a state object back into a query string (no leading "?").
 * Defaults are omitted to keep URLs short and shareable.
 */
export function serializeSearchParams(state) {
  const out = new URLSearchParams();
  if (state.from) out.set('from', state.from);
  if (state.to)   out.set('to', state.to);
  if (state.date) out.set('date', state.date);
  if (state.return) out.set('return', state.return);
  if (state.pax !== DEFAULTS.pax) out.set('pax', String(state.pax));
  if (state.cabin !== DEFAULTS.cabin) out.set('cabin', state.cabin);
  if (state.flexDates) out.set('flex_dates', '1');
  if (state.aircraft.length) out.set('aircraft', state.aircraft.join(','));
  if (state.airlines.length) out.set('airlines', state.airlines.join(','));
  if (state.direct) out.set('direct', '1');
  if (state.sort !== DEFAULTS.sort) out.set('sort', state.sort);
  if (state.shown !== DEFAULTS.shown) out.set('shown', String(state.shown));
  return out.toString();
}

/**
 * Hash of search-affecting params only. When this changes, useFlightSearch
 * refires the API. When filter or display params change, this stays stable
 * and the cached results are re-filtered/re-sorted in memory.
 */
export function searchAffectingHash(state) {
  return [
    state.from, state.to, state.date, state.return,
    state.pax, state.cabin, state.flexDates ? '1' : '0',
  ].join('|');
}

/**
 * Whether we have enough to fire a real search. /search renders an empty
 * state until this returns true.
 */
export function isSearchReady(state) {
  return Boolean(state.from && state.to && state.date);
}

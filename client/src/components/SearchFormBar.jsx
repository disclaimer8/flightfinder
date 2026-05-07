import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULTS, parseSearchParams, serializeSearchParams } from '../utils/searchParams';
import './SearchFormBar.css';

// Search-affecting param keys (state-shape names, not URL keys). Changing any
// of these means a brand-new search is about to fire — reset `shown` to its
// default so the user sees results from the top instead of being silently
// scrolled deep into a stale page count. Mirrors searchAffectingHash().
const SEARCH_AFFECTING_KEYS = new Set([
  'from', 'to', 'date', 'return', 'pax', 'cabin', 'flexDates',
]);

export default function SearchFormBar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = parseSearchParams(searchParams);
  const sentinelRef = useRef(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const update = (patch) => {
    const triggersNewSearch = Object.keys(patch).some(k => SEARCH_AFFECTING_KEYS.has(k));
    const next = {
      ...state,
      ...patch,
      ...(triggersNewSearch ? { shown: DEFAULTS.shown } : {}),
    };
    const qs = serializeSearchParams(next);
    setSearchParams(qs, { replace: true });
  };

  return (
    <>
      <div ref={sentinelRef} className="search-form-bar-sentinel" aria-hidden="true" />
      <form
        className={`search-form-bar${stuck ? ' search-form-bar--collapsed' : ''}`}
        onSubmit={e => e.preventDefault()}
        aria-label="Flight search"
      >
      <label className="sfb-field">
        <span>From</span>
        <input
          type="text"
          aria-label="From"
          value={state.from}
          onChange={e => update({ from: e.target.value.toUpperCase().slice(0, 3) })}
          maxLength={3}
          placeholder="LHR"
          autoComplete="off"
        />
      </label>

      <label className="sfb-field">
        <span>To</span>
        <input
          type="text"
          aria-label="To"
          value={state.to}
          onChange={e => update({ to: e.target.value.toUpperCase().slice(0, 3) })}
          maxLength={3}
          placeholder="JFK"
          autoComplete="off"
        />
      </label>

      <label className="sfb-field">
        <span>Date</span>
        <input
          type="date"
          aria-label="Date"
          value={state.date}
          onChange={e => update({ date: e.target.value })}
        />
      </label>

      <label className="sfb-field">
        <span>Return</span>
        <input
          type="date"
          aria-label="Return"
          value={state.return}
          onChange={e => update({ return: e.target.value })}
          min={state.date || undefined}
        />
      </label>

      <label className="sfb-field">
        <span>Passengers</span>
        <select
          aria-label="Passengers"
          value={state.pax}
          onChange={e => update({ pax: parseInt(e.target.value, 10) })}
        >
          {[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>

      <label className="sfb-field">
        <span>Cabin</span>
        <select
          aria-label="Cabin"
          value={state.cabin}
          onChange={e => update({ cabin: e.target.value })}
        >
          <option value="economy">Economy</option>
          <option value="premium-economy">Premium economy</option>
          <option value="business">Business</option>
          <option value="first">First</option>
        </select>
      </label>

      <label className="sfb-checkbox">
        <input
          type="checkbox"
          aria-label="Direct only"
          checked={state.direct}
          onChange={e => update({ direct: e.target.checked })}
        />
        Direct only
      </label>

      <label className="sfb-checkbox">
        <input
          type="checkbox"
          aria-label="Flexible dates"
          checked={state.flexDates}
          onChange={e => update({ flexDates: e.target.checked })}
        />
        ±3 days
      </label>
    </form>
    </>
  );
}

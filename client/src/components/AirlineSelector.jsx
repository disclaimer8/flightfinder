import { useState, useMemo } from 'react';
import './AirlineSelector.css';

function AirlineSelector({ departure, filterOptions, selected, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const popularNames = useMemo(() => {
    if (!filterOptions?.airlinesByCity) return [];
    return filterOptions.airlinesByCity[departure] || filterOptions.airlinesByCity.default || [];
  }, [departure, filterOptions]);

  const allAirlines = filterOptions?.airlines ?? [];

  const visibleAirlines = useMemo(() => {
    if (!expanded) {
      return allAirlines.filter(a => popularNames.includes(a.name));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return allAirlines.filter(
        a => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)
      );
    }
    return allAirlines;
  }, [expanded, allAirlines, popularNames, searchQuery]);

  const toggle = (name) => {
    onChange(selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name]);
  };

  const selectedCount = selected.length;

  return (
    <div className="airline-selector">
      <div className="airline-selector-header">
        <span className="airline-selector-label">
          Preferred airlines
          {selectedCount > 0 && (
            <span className="airline-selector-badge">{selectedCount} selected</span>
          )}
        </span>
        {selectedCount > 0 && (
          <button className="airline-selector-clear" type="button" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>

      {!departure && !expanded && (
        <p className="airline-hint">Select a departure city to see popular airlines</p>
      )}

      {(departure || expanded) && (
        <div className="airline-chips">
          {visibleAirlines.map(a => (
            <label
              key={a.code}
              className={`airline-chip ${selected.includes(a.name) ? 'active' : ''}`}
            >
              <input
                type="checkbox"
                checked={selected.includes(a.name)}
                onChange={() => toggle(a.name)}
              />
              {a.name}
            </label>
          ))}
          {visibleAirlines.length === 0 && expanded && searchQuery && (
            <p className="airline-hint">No airlines match "{searchQuery}"</p>
          )}
        </div>
      )}

      <div className="airline-selector-footer">
        {!expanded ? (
          <button
            type="button"
            className="airline-load-all"
            onClick={() => setExpanded(true)}
          >
            Load all airlines ({allAirlines.length}) ↓
          </button>
        ) : (
          <div className="airline-search-wrap">
            <input
              type="text"
              className="airline-search-input"
              placeholder="Search airlines…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="airline-collapse"
              onClick={() => { setExpanded(false); setSearchQuery(''); }}
            >
              ↑ Show less
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AirlineSelector;

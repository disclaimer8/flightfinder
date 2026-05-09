import { useState, useRef, useEffect, useCallback } from 'react';
import { useFilterOptions } from '../context/FilterOptionsContext';
import './CityAutocomplete.css';

/**
 * City + airport autocomplete picker.
 *
 * Props:
 *   value      — current IATA code (controlled, e.g. "LHR")
 *   onChange   — called with new IATA string when user selects
 *   ariaLabel  — a11y label for the input
 *   placeholder — input placeholder text
 */
export default function CityAutocomplete({ value, onChange, ariaLabel, placeholder = 'City or airport' }) {
  const filterOptions = useFilterOptions();

  // Build flat city list from filterOptions
  const cities = (() => {
    if (!filterOptions) return null;
    if (filterOptions.cities && filterOptions.cities.length > 0) {
      return filterOptions.cities;
    }
    if (filterOptions.cityGroups && filterOptions.cityGroups.length > 0) {
      const seen = new Set();
      const flat = [];
      for (const group of filterOptions.cityGroups) {
        for (const city of group.cities || []) {
          if (!seen.has(city.code)) {
            seen.add(city.code);
            flat.push(city);
          }
        }
      }
      return flat.length > 0 ? flat : null;
    }
    return null;
  })();

  // Build grouped display list using cityGroups (for dropdown display order)
  const groups = (() => {
    if (!filterOptions) return null;
    if (filterOptions.cityGroups && filterOptions.cityGroups.length > 0) {
      return filterOptions.cityGroups;
    }
    // No groups — put everything in one unnamed group
    if (cities) {
      return [{ region: '', cities }];
    }
    return null;
  })();

  // Friendly label for a code
  const labelFor = useCallback(
    (code) => {
      if (!cities || !code) return '';
      const entry = cities.find(c => c.code === code);
      return entry ? `${entry.name} · ${entry.code}` : '';
    },
    [cities]
  );

  // Internal query string while the user is typing
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // What the input shows:
  // - No data (plain mode): show the raw value prop directly
  // - When open: show the user's typed query
  // - When closed: show the friendly label (if value is known) or empty
  const inputValue = !cities ? value : (open ? query : labelFor(value));

  // Filtered options based on current query
  const filteredOptions = (() => {
    if (!cities) return [];
    const q = query.trim().toLowerCase();
    if (!q) return cities;
    return cities.filter(
      c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  })();

  // Grouped filtered options for rendering
  const filteredGroups = (() => {
    if (!groups) return [];
    const q = query.trim().toLowerCase();
    return groups
      .map(g => ({
        region: g.region,
        cities: (g.cities || []).filter(
          c => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.cities.length > 0);
  })();

  const openDropdown = () => {
    setOpen(true);
    setQuery('');
    setHighlightIdx(-1);
  };

  const closeDropdown = () => {
    setOpen(false);
    setQuery('');
    setHighlightIdx(-1);
  };

  const selectOption = (code) => {
    onChange(code);
    closeDropdown();
  };

  // Click outside → close
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // Scroll highlighted option into view
  useEffect(() => {
    if (!listRef.current || highlightIdx < 0) return;
    const items = listRef.current.querySelectorAll('[role="option"]');
    if (items[highlightIdx]) {
      items[highlightIdx].scrollIntoView?.({ block: 'nearest' });
    }
  }, [highlightIdx]);

  const handleInputClick = () => {
    if (!cities) return; // no data — plain input
    openDropdown();
  };

  const handleInputChange = (e) => {
    const raw = e.target.value;
    if (!cities) {
      // No dropdown data: behave as a plain controlled input.
      // Uppercase + truncate to 3 chars to match original input behavior.
      onChange(raw.toUpperCase().slice(0, 3));
      return;
    }
    setQuery(raw);
    if (!open) {
      setOpen(true);
      setHighlightIdx(-1);
    }
  };

  const handleInputBlur = () => {
    // Commit direct IATA code typed by user (3-letter exact match)
    const q = query.trim().toUpperCase();
    if (q.length === 3 && cities) {
      const match = cities.find(c => c.code === q);
      if (match) {
        onChange(match.code);
      }
    }
    // Don't close here — mousedown on an option fires before blur,
    // so the option click handler has already run. If the user clicks
    // outside, the mousedown handler closes. We just reset query on blur
    // to ensure the label is restored if nothing was selected.
    // Use a short timeout to let option mousedown/click fire first.
    setTimeout(() => {
      setQuery('');
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (!cities) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setQuery('');
          setHighlightIdx(0);
        } else {
          setHighlightIdx(prev =>
            prev < filteredOptions.length - 1 ? prev + 1 : prev
          );
        }
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (open) {
          setHighlightIdx(prev => (prev > 0 ? prev - 1 : 0));
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (open && highlightIdx >= 0 && filteredOptions[highlightIdx]) {
          selectOption(filteredOptions[highlightIdx].code);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        closeDropdown();
        break;
      }
      case 'Tab': {
        // Close without selecting
        closeDropdown();
        break;
      }
      default:
        break;
    }
  };

  const listboxId = ariaLabel ? `ca-listbox-${ariaLabel.replace(/\s+/g, '-').toLowerCase()}` : 'ca-listbox';

  return (
    <div ref={containerRef} className="city-autocomplete">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && highlightIdx >= 0 && filteredOptions[highlightIdx]
            ? `ca-opt-${filteredOptions[highlightIdx].code}`
            : undefined
        }
        value={inputValue}
        placeholder={placeholder}
        maxLength={!cities ? 3 : undefined}
        autoComplete="off"
        onClick={handleInputClick}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        className="city-autocomplete__input"
      />

      {open && cities && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="city-autocomplete__dropdown"
        >
          {filteredGroups.length === 0 && (
            <li className="city-autocomplete__empty" role="presentation">
              No matches
            </li>
          )}
          {filteredGroups.map((group) =>
            group.cities.map((city) => {
              // Global index among filteredOptions (match by code, not object ref)
              const globalIdx = filteredOptions.findIndex(c => c.code === city.code);
              const isHighlighted = globalIdx === highlightIdx;
              return (
                <li
                  key={city.code}
                  id={`ca-opt-${city.code}`}
                  role="option"
                  aria-selected={isHighlighted}
                  className={`city-autocomplete__option${isHighlighted ? ' city-autocomplete__option--highlighted' : ''}`}
                  onMouseDown={(e) => {
                    // Select on mousedown (not click) so we beat the input's
                    // blur → setTimeout(setQuery, 150) race that was clearing
                    // the query before click fired in prod (caught during
                    // post-deploy verify: clicking an option produced an
                    // empty input + dropdown showing all 116 cities).
                    // preventDefault keeps focus on the input so blur
                    // doesn't fire at all.
                    e.preventDefault();
                    selectOption(city.code);
                  }}
                  // Keep onClick as a fallback for keyboard activation and
                  // for fireEvent.click() in unit tests (which doesn't fire
                  // mousedown). selectOption is idempotent — second call
                  // with same code is a no-op state-wise.
                  onClick={() => selectOption(city.code)}
                >
                  {city.name} · {city.code}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

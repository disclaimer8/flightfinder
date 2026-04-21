import { useState, useEffect, useRef } from 'react';
import DatePicker from './DatePicker';
import { API_BASE } from '../utils/api';
import './AircraftSearchForm.css';

// Simple airport-autocomplete field used for both FROM and TO.
function AirportField({ id, label, value, onChange, placeholder }) {
  const [input, setInput]   = useState(value?.label || '');
  const [results, setResults] = useState([]);
  const [focused, setFocused] = useState(false);
  const debounce = useRef(null);

  useEffect(() => {
    setInput(value?.label || '');
  }, [value?.iata]);

  useEffect(() => {
    if (input.length < 2) { setResults([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      fetch(`${API_BASE}/api/aircraft/airports/search?q=${encodeURIComponent(input)}&limit=6`)
        .then(r => r.json())
        .then(d => { if (d.success) setResults(d.airports || []); })
        .catch(() => {});
    }, 260);
    return () => clearTimeout(debounce.current);
  }, [input]);

  const select = (a) => {
    const entry = { label: a.city || a.name, iata: a.iata, name: a.name };
    onChange(entry);
    setInput(entry.label);
    setResults([]);
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    if (value) onChange(null); // user typed — clear selection until they pick again
  };

  return (
    <div className="ac-search-field ac-search-field--city">
      <label className="ac-label" htmlFor={id}>{label}</label>
      <div className="ac-autocomplete">
        <input
          id={id}
          type="text"
          className="ac-input"
          placeholder={placeholder}
          value={input}
          onChange={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          autoComplete="off"
          required
        />
        {focused && results.length > 0 && (
          <ul className="ac-dropdown">
            {results.map(a => (
              <li
                key={a.iata}
                className="ac-dropdown-item"
                onMouseDown={() => select(a)}
              >
                <span className="ac-dropdown-iata">{a.iata}</span>
                <span className="ac-dropdown-name">{a.city || a.name}</span>
                <span className="ac-dropdown-country">{a.country}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AircraftSearchForm({ onSearch, loading, onCancel }) {
  const [families, setFamilies]     = useState([]);
  const [familyName, setFamilyName] = useState('');
  const [from, setFrom]             = useState(null); // { label, iata, name }
  const [date, setDate]             = useState('');
  const [passengers, setPassengers] = useState(1);
  const [directOnly, setDirectOnly] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/aircraft/families`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.families) {
          setFamilies(d.families);
          setFamilyName(d.families[0]?.name || '');
        }
      })
      .catch(() => {});
  }, []);

  const grouped = families.reduce((acc, f) => {
    (acc[f.manufacturer] = acc[f.manufacturer] || []).push(f);
    return acc;
  }, {});

  const canSubmit = Boolean(familyName && from?.iata && date);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSearch({
      familyName,
      departure: from.iata,
      date,
      passengers,
      directOnly,
    });
  };

  const minDate = new Date().toISOString().split('T')[0];

  return (
    <form className="ac-search-form" onSubmit={handleSubmit} noValidate>
      <div className="ac-search-row">
        <div className="ac-search-field ac-search-field--wide">
          <label className="ac-label" htmlFor="ac-family">Aircraft</label>
          <select
            id="ac-family"
            className="ac-select"
            value={familyName}
            onChange={e => setFamilyName(e.target.value)}
            required
          >
            {Object.entries(grouped).map(([mfr, list]) => (
              <optgroup key={mfr} label={mfr}>
                {list.map(f => (
                  <option key={f.name} value={f.name}>{f.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div className="ac-search-row">
        <AirportField
          id="ac-from"
          label="From"
          value={from}
          onChange={setFrom}
          placeholder="City or IATA (e.g. London, LHR)"
        />
      </div>

      <div className="ac-search-row">
        <div className="ac-search-field">
          <label className="ac-label">Date</label>
          <DatePicker
            value={date}
            onChange={setDate}
            min={minDate}
            placeholder="Select date"
            label="Date"
            required
          />
        </div>

        <div className="ac-search-field ac-search-field--narrow">
          <label className="ac-label">Passengers</label>
          <div className="ac-stepper">
            <button
              type="button"
              className="ac-stepper-btn"
              aria-label="Decrease passengers"
              onClick={() => setPassengers(p => Math.max(1, p - 1))}
              disabled={passengers <= 1}
            >−</button>
            <span className="ac-stepper-count">{passengers}</span>
            <button
              type="button"
              className="ac-stepper-btn"
              aria-label="Increase passengers"
              onClick={() => setPassengers(p => Math.min(9, p + 1))}
              disabled={passengers >= 9}
            >+</button>
          </div>
        </div>
      </div>

      <label className="direct-only-toggle">
        <input
          type="checkbox"
          checked={directOnly}
          onChange={(e) => setDirectOnly(e.target.checked)}
        />
        <span>Only direct flights</span>
      </label>

      <div className="ac-search-actions">
        {loading ? (
          <button type="button" className="ac-btn ac-btn-cancel" onClick={onCancel}>
            Cancel search
          </button>
        ) : (
          <button
            type="submit"
            className="ac-btn ac-btn-primary"
            disabled={!canSubmit}
          >
            Search flights
          </button>
        )}
      </div>
    </form>
  );
}

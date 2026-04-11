import { useState, useEffect, useRef } from 'react';
import DatePicker from './DatePicker';
import './AircraftSearchForm.css';

// Each entry: display label + IATA code used for the search
// Using explicit IATA codes avoids geocoding ambiguity (e.g. London → Canada)
const POPULAR_CITIES = [
  { label: 'London',        iata: 'LHR' },
  { label: 'Paris',         iata: 'CDG' },
  { label: 'Amsterdam',     iata: 'AMS' },
  { label: 'Frankfurt',     iata: 'FRA' },
  { label: 'Madrid',        iata: 'MAD' },
  { label: 'Rome',          iata: 'FCO' },
  { label: 'Dubai',         iata: 'DXB' },
  { label: 'New York',      iata: 'JFK' },
  { label: 'Los Angeles',   iata: 'LAX' },
  { label: 'Tokyo',         iata: 'NRT' },
  { label: 'Singapore',     iata: 'SIN' },
  { label: 'Istanbul',      iata: 'IST' },
  { label: 'Bangkok',       iata: 'BKK' },
  { label: 'Sydney',        iata: 'SYD' },
  { label: 'Toronto',       iata: 'YYZ' },
];

export default function AircraftSearchForm({ onSearch, loading, onCancel }) {
  const [families, setFamilies]       = useState([]);
  const [familyName, setFamilyName]   = useState('');
  const [date, setDate]               = useState('');
  const [passengers, setPassengers]   = useState(1);
  const [useCity, setUseCity]         = useState(false);
  // selectedCity: { label, iata } when from chip, or { label, iata: null } when typed
  const [selectedCity, setSelectedCity] = useState(null);
  const [cityInput, setCityInput]       = useState('');  // text field value
  const [radius, setRadius]           = useState(200);
  const [cityResults, setCityResults] = useState([]);
  const [cityFocused, setCityFocused] = useState(false);
  const cityDebounce = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    fetch('/api/aircraft/families')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.families) {
          setFamilies(d.families);
          setFamilyName(d.families[0]?.name || '');
        }
      })
      .catch(() => {});
  }, []);

  // Autocomplete for free-text input (only when user is typing, not when chip selected)
  useEffect(() => {
    if (!useCity || cityInput.length < 2) { setCityResults([]); return; }
    clearTimeout(cityDebounce.current);
    cityDebounce.current = setTimeout(() => {
      fetch(`/api/aircraft/airports/search?q=${encodeURIComponent(cityInput)}&limit=6`)
        .then(r => r.json())
        .then(d => { if (d.success) setCityResults(d.airports || []); })
        .catch(() => {});
    }, 280);
  }, [cityInput, useCity]);

  // Select from popular chips — use explicit IATA, bypass geocoding
  const selectChip = (chip) => {
    setSelectedCity(chip);
    setCityInput(chip.label);
    setCityResults([]);
  };

  // Select from autocomplete dropdown
  const selectFromDropdown = (airport) => {
    const entry = { label: airport.city || airport.name, iata: airport.iata };
    setSelectedCity(entry);
    setCityInput(entry.label);
    setCityResults([]);
  };

  // User edits the text field — clear chip selection
  const handleCityInputChange = (e) => {
    setCityInput(e.target.value);
    setSelectedCity(null); // typed value, no pinned IATA
  };

  const grouped = families.reduce((acc, f) => {
    (acc[f.manufacturer] = acc[f.manufacturer] || []).push(f);
    return acc;
  }, {});

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!familyName) return;
    const params = { familyName, date: date || null, passengers };
    if (useCity && (selectedCity || cityInput.trim())) {
      if (selectedCity?.iata) {
        // Known IATA from chip or dropdown — pass directly, skip geocoding text match
        params.iata = selectedCity.iata;
        params.radius = radius;
      } else {
        // Free text — let geocodingService resolve it
        params.city = cityInput.trim();
        params.radius = radius;
      }
    }
    onSearch(params);
  };

  const minDate = new Date().toISOString().split('T')[0];
  return (
    <form className="ac-search-form" onSubmit={handleSubmit} noValidate>
      {/* Row 1: Aircraft / Date / Passengers */}
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

        <div className="ac-search-field">
          <label className="ac-label">Date</label>
          <DatePicker
            value={date}
            onChange={setDate}
            min={minDate}
            placeholder="Select date"
            label="Date"
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

      {/* Row 2: Near city toggle */}
      <div className="ac-city-section">
        <label className="ac-toggle">
          <input
            type="checkbox"
            checked={useCity}
            onChange={e => { setUseCity(e.target.checked); if (!e.target.checked) setCity(''); }}
          />
          <span>Near city</span>
        </label>

        {useCity && (
          <div className="ac-city-body">
            {/* Popular cities */}
            <div className="ac-popular-label">Popular</div>
            <div className="ac-popular-chips">
              {POPULAR_CITIES.map(c => (
                <button
                  key={c.iata}
                  type="button"
                  className={`ac-chip${selectedCity?.iata === c.iata ? ' ac-chip--active' : ''}`}
                  onClick={() => selectChip(c)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Free-text input */}
            <div className="ac-city-input-row">
              <div className="ac-search-field ac-search-field--city">
                <label className="ac-label">Or type any city / airport</label>
                <div className="ac-autocomplete">
                  <input
                    ref={inputRef}
                    type="text"
                    className="ac-input"
                    placeholder="e.g. Munich, Nairobi, BKK…"
                    value={cityInput}
                    onChange={handleCityInputChange}
                    onFocus={() => setCityFocused(true)}
                    onBlur={() => setTimeout(() => setCityFocused(false), 150)}
                    autoComplete="off"
                  />
                  {cityFocused && cityResults.length > 0 && (
                    <ul className="ac-dropdown">
                      {cityResults.map(a => (
                        <li
                          key={a.iata}
                          className="ac-dropdown-item"
                          onMouseDown={() => selectFromDropdown(a)}
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

              <div className="ac-search-field ac-search-field--radius">
                <label className="ac-label">Radius: {radius} km</label>
                <input
                  type="range"
                  className="ac-slider"
                  min={50} max={1000} step={50}
                  value={radius}
                  onChange={e => setRadius(parseInt(e.target.value, 10))}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="ac-search-actions">
        {loading ? (
          <button type="button" className="ac-btn ac-btn-cancel" onClick={onCancel}>
            Cancel search
          </button>
        ) : (
          <button
            type="submit"
            className="ac-btn ac-btn-primary"
            disabled={!familyName || (useCity && !cityInput.trim())}
          >
            Search by aircraft
          </button>
        )}
      </div>
    </form>
  );
}

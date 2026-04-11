import { useState, useEffect, useRef } from 'react';
import './AircraftSearchForm.css';

const POPULAR_CITIES = [
  'London', 'Paris', 'Amsterdam', 'Frankfurt', 'Madrid',
  'Rome', 'Dubai', 'New York', 'Los Angeles', 'Tokyo',
  'Singapore', 'Istanbul', 'Bangkok', 'Sydney', 'Toronto',
];

export default function AircraftSearchForm({ onSearch, loading, onCancel }) {
  const [families, setFamilies]       = useState([]);
  const [familyName, setFamilyName]   = useState('');
  const [date, setDate]               = useState('');
  const [passengers, setPassengers]   = useState(1);
  const [useCity, setUseCity]         = useState(false);
  const [city, setCity]               = useState('');
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

  // Autocomplete for free-text input
  useEffect(() => {
    if (!useCity || city.length < 2) { setCityResults([]); return; }
    clearTimeout(cityDebounce.current);
    cityDebounce.current = setTimeout(() => {
      fetch(`/api/aircraft/airports/search?q=${encodeURIComponent(city)}&limit=6`)
        .then(r => r.json())
        .then(d => { if (d.success) setCityResults(d.airports || []); })
        .catch(() => {});
    }, 280);
  }, [city, useCity]);

  const selectCity = (name) => {
    setCity(name);
    setCityResults([]);
    inputRef.current?.focus();
  };

  const grouped = families.reduce((acc, f) => {
    (acc[f.manufacturer] = acc[f.manufacturer] || []).push(f);
    return acc;
  }, {});

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!familyName) return;
    onSearch({
      familyName,
      date:       date || null,
      passengers,
      city:       useCity ? city  : null,
      radius:     useCity ? radius : null,
    });
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
          <label className="ac-label" htmlFor="ac-date">Date</label>
          <input
            id="ac-date"
            type="date"
            className="ac-input"
            value={date}
            min={minDate}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        <div className="ac-search-field ac-search-field--narrow">
          <label className="ac-label" htmlFor="ac-pax">Passengers</label>
          <input
            id="ac-pax"
            type="number"
            className="ac-input"
            value={passengers}
            min={1} max={9}
            onChange={e => setPassengers(Math.max(1, Math.min(9, parseInt(e.target.value, 10) || 1)))}
          />
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
                  key={c}
                  type="button"
                  className={`ac-chip${city === c ? ' ac-chip--active' : ''}`}
                  onClick={() => selectCity(c)}
                >
                  {c}
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
                    value={city}
                    onChange={e => setCity(e.target.value)}
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
                          onMouseDown={() => selectCity(a.city || a.name)}
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
            disabled={!familyName || (useCity && !city.trim())}
          >
            Search by aircraft
          </button>
        )}
      </div>
    </form>
  );
}

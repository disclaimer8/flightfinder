import { useState, useEffect, useRef } from 'react';
import './AircraftSearchForm.css';

/**
 * AircraftSearchForm
 *
 * Lets the user search flights by aircraft family with an optional
 * city + radius filter.
 *
 * Props:
 *   onSearch(params) — called with { familyName, city, radius, date, passengers }
 *   loading          — bool, disables the button while searching
 *   onCancel()       — called when user clicks Cancel during search
 */
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

  // Load aircraft families from server
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

  // Autocomplete city input
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

  // Group families by manufacturer for the select
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
      {/* Aircraft family selector */}
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

        {/* Date */}
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

        {/* Passengers */}
        <div className="ac-search-field ac-search-field--narrow">
          <label className="ac-label" htmlFor="ac-pax">Passengers</label>
          <input
            id="ac-pax"
            type="number"
            className="ac-input"
            value={passengers}
            min={1}
            max={9}
            onChange={e => setPassengers(Math.max(1, Math.min(9, parseInt(e.target.value, 10) || 1)))}
          />
        </div>
      </div>

      {/* Near-city filter */}
      <div className="ac-search-row ac-search-row--city">
        <label className="ac-toggle">
          <input
            type="checkbox"
            checked={useCity}
            onChange={e => setUseCity(e.target.checked)}
          />
          <span>Near city</span>
        </label>

        {useCity && (
          <>
            {/* City autocomplete */}
            <div className="ac-search-field ac-search-field--city">
              <div className="ac-autocomplete">
                <input
                  type="text"
                  className="ac-input"
                  placeholder="City or airport (e.g. London)"
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
                        onMouseDown={() => { setCity(a.city || a.name); setCityResults([]); }}
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

            {/* Radius slider */}
            <div className="ac-search-field ac-search-field--radius">
              <label className="ac-label">Radius: {radius} km</label>
              <input
                type="range"
                className="ac-slider"
                min={50}
                max={1000}
                step={50}
                value={radius}
                onChange={e => setRadius(parseInt(e.target.value, 10))}
              />
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="ac-search-actions">
        {loading ? (
          <button type="button" className="ac-btn ac-btn-cancel" onClick={onCancel}>
            Cancel search
          </button>
        ) : (
          <button type="submit" className="ac-btn ac-btn-primary" disabled={!familyName}>
            Search by aircraft
          </button>
        )}
      </div>
    </form>
  );
}

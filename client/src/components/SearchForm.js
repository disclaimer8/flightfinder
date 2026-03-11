import React, { useState, useEffect } from 'react';
import './SearchForm.css';

const IS_DEV = import.meta.env.DEV;

function SearchForm({ onSearch, onExplore, filterOptions }) {
  const [mode, setMode] = useState('search'); // 'search' | 'explore'
  const [tripType, setTripType] = useState('one-way');
  const [apiProvider, setApiProvider] = useState('amadeus'); // 'amadeus' | 'duffel'
  const [filters, setFilters] = useState({
    departure: '',
    arrival: '',
    date: '',
    returnDate: '',
    passengers: '1',
    aircraftType: '',
    aircraftModel: ''
  });

  useEffect(() => {
    setFilters(prev => ({ ...prev, date: getTomorrowDate() }));
  }, []);

  const getTomorrowDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const handleTripType = (type) => {
    setTripType(type);
    if (type === 'one-way') {
      setFilters(prev => ({ ...prev, returnDate: '' }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'explore') {
      onExplore({
        departure: filters.departure,
        date: filters.date,
        aircraftType: filters.aircraftType,
        aircraftModel: filters.aircraftModel,
      });
    } else {
      onSearch({
        ...filters,
        returnDate: tripType === 'round-trip' ? filters.returnDate : '',
        api: IS_DEV ? apiProvider : undefined,
      });
    }
  };

  const handleFilterByType = (type) => {
    setFilters(prev => ({ ...prev, aircraftType: type, aircraftModel: '' }));
  };

  const isSearchDisabled = mode === 'search'
    ? (!filters.departure || !filters.arrival || (tripType === 'round-trip' && !filters.returnDate))
    : (!filters.departure || (!filters.aircraftType && !filters.aircraftModel));

  return (
    <div className="search-form-container">
      {/* Mode toggle */}
      <div className="mode-toggle">
        <button
          type="button"
          className={`mode-btn ${mode === 'search' ? 'active' : ''}`}
          onClick={() => setMode('search')}
        >
          🔍 Search Route
        </button>
        <button
          type="button"
          className={`mode-btn ${mode === 'explore' ? 'active' : ''}`}
          onClick={() => setMode('explore')}
        >
          🌍 Explore Destinations
        </button>
      </div>

      {mode === 'search' && (
        <div className="trip-type-toggle">
          <button
            type="button"
            className={`trip-btn ${tripType === 'one-way' ? 'active' : ''}`}
            onClick={() => handleTripType('one-way')}
          >
            One Way
          </button>
          <button
            type="button"
            className={`trip-btn ${tripType === 'round-trip' ? 'active' : ''}`}
            onClick={() => handleTripType('round-trip')}
          >
            Round Trip
          </button>
        </div>
      )}

      {mode === 'explore' && (
        <p className="explore-hint">
          Pick a departure city and aircraft — we'll find every destination you can reach on it.
        </p>
      )}

      <form onSubmit={handleSubmit} className="search-form">
        <div className="form-row">
          <div className="form-group">
            <label>From</label>
            <select name="departure" value={filters.departure} onChange={handleChange}>
              <option value="">Select departure city</option>
              {filterOptions?.cities.map(city => (
                <option key={city.code} value={city.code}>{city.name} ({city.code})</option>
              ))}
            </select>
          </div>

          {mode === 'search' && (
            <div className="form-group">
              <label>To</label>
              <select name="arrival" value={filters.arrival} onChange={handleChange}>
                <option value="">Select arrival city</option>
                {filterOptions?.cities.map(city => (
                  <option key={city.code} value={city.code}>{city.name} ({city.code})</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Departure Date</label>
            <input
              type="date"
              name="date"
              value={filters.date}
              onChange={handleChange}
              min={getTomorrowDate()}
            />
          </div>

          {mode === 'search' && tripType === 'round-trip' && (
            <div className="form-group">
              <label>Return Date</label>
              <input
                type="date"
                name="returnDate"
                value={filters.returnDate}
                onChange={handleChange}
                min={filters.date || getTomorrowDate()}
              />
            </div>
          )}

          {mode === 'search' && (
            <div className="form-group">
              <label>Passengers</label>
              <input
                type="number"
                name="passengers"
                value={filters.passengers}
                onChange={handleChange}
                min="1"
                max="9"
              />
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>
              Aircraft Type
              {mode === 'explore' && <span className="field-required"> *</span>}
            </label>
            <select name="aircraftType" value={filters.aircraftType} onChange={handleChange}>
              <option value="">All types</option>
              {filterOptions?.aircraftTypes.map(type => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Aircraft Model</label>
            <select
              name="aircraftModel"
              value={filters.aircraftModel}
              onChange={handleChange}
              disabled={!filters.aircraftType}
            >
              <option value="">All models</option>
              {filterOptions?.aircraft
                ?.filter(a => !filters.aircraftType || a.type === filters.aircraftType)
                .map(aircraft => (
                  <option key={aircraft.code} value={aircraft.code}>
                    {aircraft.name} ({aircraft.code})
                  </option>
                ))
              }
            </select>
          </div>
        </div>

        {IS_DEV && mode === 'search' && (
          <div className="dev-api-toggle">
            <span className="dev-label">⚙️ API:</span>
            {['amadeus', 'duffel', 'kiwi'].map(provider => (
              <button
                key={provider}
                type="button"
                className={`dev-api-btn ${apiProvider === provider ? 'active' : ''}`}
                onClick={() => setApiProvider(provider)}
              >
                {provider}
              </button>
            ))}
          </div>
        )}

        <button type="submit" className="btn-search" disabled={isSearchDisabled}>
          {mode === 'explore' ? '🌍 Find Destinations' : 'Search Flights'}
        </button>
      </form>

      {mode === 'search' && (
        <div className="quick-filters">
          <p>Filter by type:</p>
          <div className="filter-buttons">
            {['turboprop', 'jet', 'regional', 'wide-body'].map(type => (
              <button
                key={type}
                className={`badge ${filters.aircraftType === type ? 'active' : ''}`}
                onClick={() => handleFilterByType(type)}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
            <button className="badge clear" onClick={() => handleFilterByType('')}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchForm;

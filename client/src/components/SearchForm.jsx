import { useState, useEffect } from 'react';
import { useFilterOptions } from '../context/FilterOptionsContext';
import './SearchForm.css';
import DatePicker from './DatePicker';

const IS_DEV = import.meta.env.DEV;

function SearchForm({ onSearch, onExplore, loading, prefillArrival, onPrefillUsed }) {
  const filterOptions = useFilterOptions();
  const [mode, setMode] = useState('search'); // 'search' | 'explore'
  const [tripType, setTripType] = useState('one-way');
  const [apiProvider, setApiProvider] = useState('amadeus');
  const [filters, setFilters] = useState({
    departure: '',
    arrival: '',
    date: '',
    returnDate: '',
    passengers: '1',
    aircraftType: '',
    aircraftModel: '',
  });

  useEffect(() => {
    setFilters(prev => ({ ...prev, date: getTomorrowDate() }));
  }, []);

  useEffect(() => {
    if (!prefillArrival) return;
    setMode('search');
    setFilters(prev => ({ ...prev, arrival: prefillArrival }));
    onPrefillUsed?.();
  }, [prefillArrival]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (loading) return;
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

  const sameCityError = mode === 'search'
    && filters.departure
    && filters.arrival
    && filters.departure === filters.arrival;

  const isSearchDisabled = loading || sameCityError || (
    mode === 'search'
      ? (!filters.departure || !filters.arrival || (tripType === 'round-trip' && !filters.returnDate))
      : (!filters.departure || (!filters.aircraftType && !filters.aircraftModel))
  );

  const disabledHint = (() => {
    if (loading) return 'Search in progress…';
    if (mode === 'search') {
      if (sameCityError) return 'Departure and arrival cannot be the same city';
      if (!filters.departure) return 'Select a departure city';
      if (!filters.arrival) return 'Select an arrival city';
      if (tripType === 'round-trip' && !filters.returnDate) return 'Select a return date';
    } else {
      if (!filters.departure) return 'Select a departure city';
      if (!filters.aircraftType && !filters.aircraftModel) return 'Select an aircraft type or model';
    }
    return null;
  })();

  return (
    <div className="search-form-container">
      {/* Mode toggle */}
      <div className="mode-toggle" role="group" aria-label="Search mode">
        <button
          type="button"
          className={`mode-btn ${mode === 'search' ? 'active' : ''}`}
          aria-pressed={mode === 'search'}
          onClick={() => setMode('search')}
        >
          <span aria-hidden="true">🔍</span> Search Route
        </button>
        <button
          type="button"
          className={`mode-btn ${mode === 'explore' ? 'active' : ''}`}
          aria-pressed={mode === 'explore'}
          onClick={() => setMode('explore')}
        >
          <span aria-hidden="true">🌍</span> Explore Destinations
        </button>
      </div>

      {mode === 'search' && (
        <div className="trip-type-toggle" role="group" aria-label="Trip type">
          <button
            type="button"
            className={`trip-btn ${tripType === 'one-way' ? 'active' : ''}`}
            aria-pressed={tripType === 'one-way'}
            onClick={() => handleTripType('one-way')}
          >
            One Way
          </button>
          <button
            type="button"
            className={`trip-btn ${tripType === 'round-trip' ? 'active' : ''}`}
            aria-pressed={tripType === 'round-trip'}
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
            <label htmlFor="sf-departure">From</label>
            <select id="sf-departure" name="departure" value={filters.departure} onChange={handleChange}>
              <option value="">Select departure city</option>
              {filterOptions?.cities.map(city => (
                <option key={city.code} value={city.code}>{city.name} ({city.code})</option>
              ))}
            </select>
          </div>

          {mode === 'search' && (
            <div className="form-group">
              <label htmlFor="sf-arrival">To</label>
              <select
                id="sf-arrival"
                name="arrival"
                value={filters.arrival}
                onChange={handleChange}
                className={sameCityError ? 'select-error' : ''}
                aria-describedby={sameCityError ? 'sf-same-city-err' : undefined}
                aria-invalid={sameCityError || undefined}
              >
                <option value="">Select arrival city</option>
                {filterOptions?.cities.map(city => (
                  <option key={city.code} value={city.code}>{city.name} ({city.code})</option>
                ))}
              </select>
              {sameCityError && (
                <span id="sf-same-city-err" className="field-error" role="alert">
                  Departure and arrival cannot be the same city
                </span>
              )}
            </div>
          )}
        </div>

        <div className="form-row">
          <DatePicker
            label="Departure Date"
            value={filters.date}
            onChange={(v) => setFilters(prev => ({
              ...prev,
              date: v,
              returnDate: prev.returnDate && prev.returnDate <= v ? '' : prev.returnDate,
            }))}
            min={getTomorrowDate()}
            placeholder="Select departure date"
          />

          {mode === 'search' && tripType === 'round-trip' && (
            <DatePicker
              label="Return Date"
              value={filters.returnDate}
              onChange={(v) => setFilters(prev => ({ ...prev, returnDate: v }))}
              min={filters.date || getTomorrowDate()}
              placeholder="Select return date"
            />
          )}

          {mode === 'search' && (
            <div className="form-group">
              <label htmlFor="sf-passengers">Passengers</label>
              <input
                id="sf-passengers"
                type="number"
                name="passengers"
                value={filters.passengers}
                onChange={handleChange}
                min="1"
                max="9"
                aria-describedby="sf-passengers-hint"
              />
              <span id="sf-passengers-hint" className="field-hint">1–9</span>
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="sf-aircraft-type">
              Aircraft Type
              {mode === 'explore' && <span className="field-required" aria-hidden="true"> *</span>}
              {mode === 'explore' && <span className="sr-only"> (required)</span>}
            </label>
            <select id="sf-aircraft-type" name="aircraftType" value={filters.aircraftType} onChange={handleChange}>
              <option value="">All types</option>
              {filterOptions?.aircraftTypes.map(type => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="sf-aircraft-model">Aircraft Model</label>
            <select
              id="sf-aircraft-model"
              name="aircraftModel"
              value={filters.aircraftModel}
              onChange={handleChange}
              disabled={!filters.aircraftType}
              title={!filters.aircraftType ? 'Select an Aircraft Type first' : undefined}
              aria-describedby={!filters.aircraftType ? 'sf-model-hint' : undefined}
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
            {!filters.aircraftType && (
              <span id="sf-model-hint" className="field-hint">Select a type above to filter models</span>
            )}
          </div>
        </div>

        {IS_DEV && mode === 'search' && (
          <div className="dev-api-toggle">
            <span className="dev-label">⚙️ API:</span>
            {['amadeus', 'duffel'].map(provider => (
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

        <button
          type="submit"
          className="btn-search"
          disabled={isSearchDisabled}
          aria-describedby={isSearchDisabled && disabledHint ? 'sf-submit-hint' : undefined}
        >
          {loading
            ? 'Searching…'
            : mode === 'explore'
              ? '🌍 Find Destinations'
              : 'Search Flights'}
        </button>
        {isSearchDisabled && disabledHint && (
          <span id="sf-submit-hint" className="submit-hint">{disabledHint}</span>
        )}
      </form>

      {mode === 'search' && (
        <div className="quick-filters">
          <p id="quick-filter-label">Filter by type:</p>
          <div className="filter-buttons" role="group" aria-labelledby="quick-filter-label">
            {['turboprop', 'jet', 'regional', 'wide-body'].map(type => (
              <button
                key={type}
                className={`badge ${filters.aircraftType === type ? 'active' : ''}`}
                aria-pressed={filters.aircraftType === type}
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

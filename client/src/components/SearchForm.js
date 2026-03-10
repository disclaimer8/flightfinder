import React, { useState, useEffect } from 'react';
import './SearchForm.css';

function SearchForm({ onSearch, filterOptions }) {
  const [tripType, setTripType] = useState('one-way');
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
    onSearch({ ...filters, returnDate: tripType === 'round-trip' ? filters.returnDate : '' });
  };

  const handleFilterByType = (type) => {
    setFilters(prev => ({ ...prev, aircraftType: type, aircraftModel: '' }));
  };

  return (
    <div className="search-form-container">
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

          <div className="form-group">
            <label>To</label>
            <select name="arrival" value={filters.arrival} onChange={handleChange}>
              <option value="">Select arrival city</option>
              {filterOptions?.cities.map(city => (
                <option key={city.code} value={city.code}>{city.name} ({city.code})</option>
              ))}
            </select>
          </div>
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

          {tripType === 'round-trip' && (
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
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Aircraft Type</label>
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

        <button
          type="submit"
          className="btn-search"
          disabled={
            !filters.departure ||
            !filters.arrival ||
            (tripType === 'round-trip' && !filters.returnDate)
          }
        >
          Search Flights
        </button>
      </form>

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
    </div>
  );
}

export default SearchForm;

import React, { useState, useMemo } from 'react';
import FlightCard from './FlightCard';
import FlightFilters from './FlightFilters';
import './FlightResults.css';

const SORT_OPTIONS = [
  { id: 'price_asc',  label: 'Cheapest' },
  { id: 'duration',   label: 'Quickest' },
  { id: 'departure',  label: 'Earliest' },
  { id: 'price_desc', label: 'Most expensive' },
];

function parseDurationMins(str) {
  if (!str) return Infinity;
  const h = str.match(/(\d+)h/);
  const m = str.match(/(\d+)m/);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
}

function getTimeSlot(isoString) {
  const h = new Date(isoString).getHours();
  if (h < 6)  return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

const EMPTY_FILTERS = {
  stops: [],
  airlines: [],
  timeOfDay: [],
  maxPrice: null,
};

function FlightResults({ flights, source }) {
  const [sortBy, setSortBy] = useState('price_asc');
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // Reset filters when a new search is performed
  const [prevFlights, setPrevFlights] = useState(flights);
  if (flights !== prevFlights) {
    setPrevFlights(flights);
    setFilters(EMPTY_FILTERS);
  }

  const displayed = useMemo(() => {
    let result = [...flights];

    if (filters.stops.length > 0) {
      result = result.filter(f => {
        const s = f.stops ?? 0;
        return filters.stops.some(v => v === '2+' ? s >= 2 : s === v);
      });
    }

    if (filters.airlines.length > 0) {
      result = result.filter(f => filters.airlines.includes(f.airline));
    }

    if (filters.timeOfDay.length > 0) {
      result = result.filter(f => filters.timeOfDay.includes(getTimeSlot(f.departureTime)));
    }

    if (filters.maxPrice !== null) {
      result = result.filter(f => parseFloat(f.price) <= filters.maxPrice);
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'price_asc':  return parseFloat(a.price) - parseFloat(b.price);
        case 'price_desc': return parseFloat(b.price) - parseFloat(a.price);
        case 'duration':   return parseDurationMins(a.duration) - parseDurationMins(b.duration);
        case 'departure':  return new Date(a.departureTime) - new Date(b.departureTime);
        default:           return 0;
      }
    });

    return result;
  }, [flights, sortBy, filters]);

  if (flights.length === 0) {
    return (
      <div className="results-container">
        <div className="no-results">
          <p>No flights found. Try adjusting your search criteria.</p>
        </div>
      </div>
    );
  }

  const hiddenCount = flights.length - displayed.length;

  return (
    <div className="results-container">
      <div className="results-layout">
        <FlightFilters flights={flights} filters={filters} onChange={setFilters} />

        <div className="results-main">
          <div className="results-header">
            <span className="results-count">
              {displayed.length} of {flights.length} flights
              {hiddenCount > 0 && (
                <span className="hidden-count"> · {hiddenCount} filtered out</span>
              )}
            </span>
            {source && (
              <span className={`source-badge source-${source}`}>
                {source === 'amadeus' ? '🌍 Amadeus' : source === 'duffel' ? '🌍 Duffel' : source === 'kiwi' ? '🌍 Kiwi' : '📋 Demo'}
              </span>
            )}
          </div>

          <div className="sort-bar">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.id}
                className={`sort-btn ${sortBy === opt.id ? 'active' : ''}`}
                onClick={() => setSortBy(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {displayed.length === 0 ? (
            <div className="no-results">
              <p>No flights match the current filters.</p>
              <button className="btn-clear-filters" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="flights-list">
              {displayed.map(flight => (
                <FlightCard key={flight.id} flight={flight} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FlightResults;

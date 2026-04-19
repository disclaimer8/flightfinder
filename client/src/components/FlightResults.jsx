import { useState, useEffect, useMemo } from 'react';
import FlightCard from './FlightCard';
import FlightFilters from './FlightFilters';
import { parseDurationMins, getTimeSlot } from '../utils/flightUtils';
import './FlightResults.css';

const IS_DEV = import.meta.env.DEV;

const SORT_OPTIONS = [
  { id: 'price_asc',  label: 'Cheapest' },
  { id: 'duration',   label: 'Quickest' },
  { id: 'departure',  label: 'Earliest' },
  { id: 'arrival',    label: 'Latest dep.' },
];

const EMPTY_FILTERS = {
  stops: [],
  airlines: [],
  timeOfDay: [],
  maxPrice: null,
};

function FlightResults({ flights, source, hasSearched, initialAirlines = [] }) {
  const [sortBy, setSortBy] = useState('price_asc');
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // Reset filters and sort when new search results arrive; pre-apply airline selection from form
  useEffect(() => {
    setFilters({ ...EMPTY_FILTERS, airlines: initialAirlines });
    setSortBy('price_asc');
  }, [flights]); // eslint-disable-line react-hooks/exhaustive-deps

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
        case 'arrival':    return new Date(b.departureTime) - new Date(a.departureTime);
        default:           return 0;
      }
    });

    return result;
  }, [flights, sortBy, filters]);

  // Before first search: show nothing
  if (!hasSearched) return null;

  if (flights.length === 0) {
    return (
      <div className="results-container">
        <div className="no-results">
          <p>No flights found for this route.</p>
          <ul className="no-results-tips">
            <li>Check that departure and arrival cities are different</li>
            <li>Try a different date or nearby dates</li>
            <li>Remove the aircraft type or model filter</li>
            <li>Increase the number of passengers</li>
          </ul>
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
            {IS_DEV && source && (
              <span className={`source-badge source-${source}`}>
                {source === 'amadeus' ? 'Amadeus' : source === 'duffel' ? 'Duffel' : '📋 Demo'}
              </span>
            )}
          </div>

          <div className="sort-bar" role="group" aria-label="Sort flights by">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.id}
                className={`sort-btn ${sortBy === opt.id ? 'active' : ''}`}
                aria-pressed={sortBy === opt.id}
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

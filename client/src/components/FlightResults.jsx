import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import FlightCard from './FlightCard';
import FlightFilters from './FlightFilters';
import { parseDurationMins, getTimeSlot } from '../utils/flightUtils';
import './FlightResults.css';

const IS_DEV = import.meta.env.DEV;

// "5h 30m" → "PT5H30M"; accepts "2h", "45m", "2h 5m", "0m". Returns null
// if the input is not a recognisable duration so JSON-LD can omit the
// estimatedFlightDuration field rather than emit an invalid ISO string.
function durationToIso(s) {
  if (typeof s !== 'string') return null;
  const m = /^(?:(\d+)h)?\s*(?:(\d+)m)?$/.exec(s.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const h = parseInt(m[1] || '0', 10);
  const mm = parseInt(m[2] || '0', 10);
  return `PT${h}H${mm}M`;
}

// Build schema.org Flight + Offer JSON-LD for the top N displayed flights.
// Per Google's guidelines, only emit fields we can fill reliably; omit
// rather than stub otherwise the rich result may get flagged.
function buildFlightJsonLd(flights, max = 10) {
  const list = flights.slice(0, max).map((f, i) => {
    const node = {
      '@type': 'Flight',
      position: i + 1,
      flightNumber: f.flightNumber || undefined,
      airline: f.airline ? { '@type': 'Airline', name: f.airline } : undefined,
      departureAirport: f.departure?.code
        ? { '@type': 'Airport', iataCode: f.departure.code }
        : undefined,
      arrivalAirport: f.arrival?.code
        ? { '@type': 'Airport', iataCode: f.arrival.code }
        : undefined,
      departureTime: f.departureTime || undefined,
      arrivalTime: f.arrivalTime || undefined,
      estimatedFlightDuration: durationToIso(f.duration) || undefined,
      aircraft: f.aircraft?.name || f.aircraftName || f.aircraftCode || undefined,
    };
    if (f.price != null) {
      node.offers = {
        '@type': 'Offer',
        price: String(f.price),
        priceCurrency: f.currency || 'USD',
        availability: 'https://schema.org/InStock',
      };
    }
    // Drop undefined keys so the emitted JSON is clean.
    for (const k of Object.keys(node)) if (node[k] === undefined) delete node[k];
    return node;
  });
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: list.length,
    itemListElement: list.map((flight, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: flight,
    })),
  };
}

const SORT_OPTIONS = [
  { id: 'price_asc',  label: 'Cheapest' },
  { id: 'duration',   label: 'Quickest' },
  { id: 'departure',  label: 'Earliest' },
  { id: 'arrival',    label: 'Latest dep.' },
];

// Source domain after the orchestrator refactor:
// google → ita → travelpayouts → cache → stale-cache → none, plus 'mock'
// for explicit ?useMockData=true. Legacy amadeus/duffel kept for any cached
// frontend bundle still referencing them.
const SOURCE_LABELS = {
  google: '✈ Google Flights',
  ita: '🛫 ITA Matrix',
  travelpayouts: '💸 Travelpayouts',
  cache: '🗂 Cached',
  'stale-cache': '⏱ Stale (24h)',
  none: '❌ No results',
  mock: '📋 Demo',
  amadeus: 'Amadeus',
  duffel: 'Duffel',
};
const SOURCE_CLASSES = {
  google: 'source-google',
  ita: 'source-ita',
  travelpayouts: 'source-travelpayouts',
  cache: 'source-cache',
  'stale-cache': 'source-stale',
  none: 'source-none',
  mock: 'source-mock',
  amadeus: 'source-amadeus',
  duffel: 'source-duffel',
};

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
  const jsonLd = useMemo(() => buildFlightJsonLd(displayed, 10), [displayed]);

  return (
    <div className="results-container">
      {jsonLd.numberOfItems > 0 && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
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
            <Link to="/safety/global" className="results-safety-link" rel="nofollow">
              Browse aviation safety data →
            </Link>
            {IS_DEV && source && (
              <span className={`source-badge ${SOURCE_CLASSES[source] || ''}`}>
                {SOURCE_LABELS[source] || source}
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
              {displayed.map((flight, i) => (
                <FlightCard key={flight.id} flight={flight} showProTeaser={i === 0} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FlightResults;

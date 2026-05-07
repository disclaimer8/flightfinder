import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import SiteLayout from '../components/SiteLayout';
import SkeletonResults from '../components/SkeletonResults';
import FlightResults from '../components/FlightResults';
import ErrorBoundary from '../components/ErrorBoundary';
import SearchFormBar from '../components/SearchFormBar';
import FilterChipRow from '../components/FilterChipRow';
import ScrollRestoration from '../components/ScrollRestoration';
import { useFilterOptions } from '../hooks/useFilterOptions';
import { FilterOptionsContext } from '../context/FilterOptionsContext';
import { useUrlFlightSearch } from '../hooks/useFlightSearch';
import { parseSearchParams, isSearchReady } from '../utils/searchParams';
import { computeSafetyScore } from '../utils/safetyScore';
import './Search.css';

function flightAirlineCode(f) {
  return f.carrier || f.airlineIata || f.airline?.code || (typeof f.airline === 'string' ? f.airline : null);
}

function flightAircraftSlug(f) {
  return f.aircraftSlug || f.aircraft?.slug || '';
}

function flightStops(f) {
  return f.stops ?? 0;
}

function flightDuration(f) {
  return f.durationMinutes ?? f.duration ?? Infinity;
}

function flightPrice(f) {
  return f.price?.amount ?? (typeof f.price === 'number' ? f.price : Infinity);
}


export default function Search() {
  const { filterOptions } = useFilterOptions();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseSearchParams(searchParams), [searchParams]);
  const ready = isSearchReady(state);

  const { flights, loading, loadingMessage, error, apiSource, hasSearched, clearError } =
    useUrlFlightSearch(ready ? state : null);

  // Client-side filters (filter-only params don't trigger API refetch)
  const filteredFlights = useMemo(() => {
    let out = flights;
    if (state.direct) {
      out = out.filter(f => flightStops(f) === 0);
    }
    if (state.airlines.length) {
      const wanted = new Set(state.airlines);
      out = out.filter(f => wanted.has(flightAirlineCode(f)));
    }
    if (state.aircraft.length) {
      const wanted = new Set(state.aircraft);
      out = out.filter(f => wanted.has(flightAircraftSlug(f)));
    }
    return out;
  }, [flights, state.direct, state.airlines, state.aircraft]);

  // Client-side sort (display-only, doesn't trigger refetch)
  const sortedFlights = useMemo(() => {
    const arr = [...filteredFlights];
    switch (state.sort) {
      case 'fastest':
        arr.sort((a, b) => flightDuration(a) - flightDuration(b));
        break;
      case 'safety':
        arr.sort((a, b) => computeSafetyScore(b) - computeSafetyScore(a));
        break;
      case 'departure-asc':
        arr.sort((a, b) => String(a.departureTime || '').localeCompare(String(b.departureTime || '')));
        break;
      case 'departure-desc':
        arr.sort((a, b) => String(b.departureTime || '').localeCompare(String(a.departureTime || '')));
        break;
      case 'cheapest':
      default:
        arr.sort((a, b) => flightPrice(a) - flightPrice(b));
        break;
    }
    return arr;
  }, [filteredFlights, state.sort]);

  const visibleFlights = useMemo(
    () => sortedFlights.slice(0, state.shown),
    [sortedFlights, state.shown]
  );

  const handleShowMore = () => {
    const next = new URLSearchParams(searchParams);
    next.set('shown', String(state.shown + 30));
    setSearchParams(next, { replace: true });
  };

  return (
    <FilterOptionsContext.Provider value={filterOptions}>
      <div data-testid="page-search">
        <SiteLayout>
          <section className="search-results-section">
            <SearchFormBar />
            {ready && <FilterChipRow />}
            {!ready && (
              <div className="search-empty">
                <h1>Search for flights</h1>
                <p>Pick origin, destination, and date to see flights.</p>
              </div>
            )}

            {ready && (
              <>
                <div className="search-summary" aria-live="polite">
                  <strong>{state.from} → {state.to}</strong>
                  {' · '}{state.date}
                  {state.return ? ` · return ${state.return}` : ''}
                  {' · '}{state.pax} {state.pax === 1 ? 'passenger' : 'passengers'}
                  {' · '}{state.cabin}
                  {state.flexDates ? ' · flexible ±3 days' : ''}
                </div>

                {error && (
                  <div className="error-banner" role="alert">
                    <span>{error}</span>
                    <button className="error-dismiss" onClick={clearError} aria-label="Dismiss">×</button>
                  </div>
                )}

                {loading && <SkeletonResults message={loadingMessage} />}

                {!loading && hasSearched && (
                  <ErrorBoundary>
                    <ScrollRestoration ready={visibleFlights.length > 0} />
                    <FlightResults
                      flights={visibleFlights}
                      source={apiSource}
                      hasSearched={hasSearched}
                    />
                    {state.shown < sortedFlights.length && (
                      <div className="show-more-row">
                        <button
                          type="button"
                          className="btn-show-more"
                          onClick={handleShowMore}
                        >
                          Show {Math.min(30, sortedFlights.length - state.shown)} more results
                          {' '}({sortedFlights.length - state.shown} remaining)
                        </button>
                      </div>
                    )}
                  </ErrorBoundary>
                )}
              </>
            )}
          </section>
        </SiteLayout>
      </div>
    </FilterOptionsContext.Provider>
  );
}

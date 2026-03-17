import { useState, useEffect } from 'react';
import axios from 'axios';
import SearchForm from './components/SearchForm';
import FlightResults from './components/FlightResults';
import ExploreResults from './components/ExploreResults';
import APIStatus from './components/APIStatus';
import './App.css';

function App() {
  const [flights, setFlights] = useState([]);
  const [exploreResults, setExploreResults] = useState(null);
  const [exploreContext, setExploreContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [filterOptions, setFilterOptions] = useState(null);
  const [apiSource, setApiSource] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [prefillArrival, setPrefillArrival] = useState(null);

  useEffect(() => {
    fetchFilterOptions();
  }, []);

  const fetchFilterOptions = async () => {
    try {
      const response = await axios.get('/api/flights/filter-options');
      setFilterOptions(response.data);
      if (response.data.apiStatus) {
        setApiStatus(response.data.apiStatus);
      }
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  const handleSearch = async (filters) => {
    setExploreResults(null);
    setError(null);
    setLoading(true);
    setLoadingMessage('Searching flights…');
    try {
      const params = new URLSearchParams();
      if (filters.departure)    params.append('departure', filters.departure);
      if (filters.arrival)      params.append('arrival', filters.arrival);
      if (filters.date)         params.append('date', filters.date);
      if (filters.passengers)   params.append('passengers', filters.passengers);
      if (filters.aircraftType)  params.append('aircraftType', filters.aircraftType);
      if (filters.aircraftModel) params.append('aircraftModel', filters.aircraftModel);
      if (filters.returnDate)   params.append('returnDate', filters.returnDate);
      if (filters.api)          params.append('api', filters.api);

      const response = await axios.get(`/api/flights?${params}`);
      setFlights(response.data.data || []);
      setApiSource(response.data.source);
    } catch (err) {
      console.error('Error searching flights:', err);
      setError('Search failed. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDestination = (destinationCode) => {
    setPrefillArrival(destinationCode);
    setExploreResults(null);
  };

  const handleExplore = async (params) => {
    setFlights([]);
    setError(null);
    setLoading(true);
    setLoadingMessage('Scanning destinations…');
    try {
      const p = new URLSearchParams();
      p.append('departure', params.departure);
      if (params.date)          p.append('date', params.date);
      if (params.aircraftType)  p.append('aircraftType', params.aircraftType);
      if (params.aircraftModel) p.append('aircraftModel', params.aircraftModel);

      const response = await axios.get(`/api/flights/explore?${p}`);
      setExploreResults(response.data.data || []);

      const ac = params.aircraftModel
        ? filterOptions?.aircraft?.find(a => a.code === params.aircraftModel)
        : params.aircraftType
          ? { name: params.aircraftType, type: params.aircraftType }
          : null;

      setExploreContext({ departure: params.departure, aircraft: ac });
    } catch (err) {
      console.error('Error exploring destinations:', err);
      setError('Explore failed. Please check your connection and try again.');
      setExploreResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <section className="hero">
        <nav className="nav">
          <div className="nav-brand">
            <span className="brand-icon">✈</span>
            <span className="brand-name">FlightFinder</span>
          </div>
          {apiStatus && <APIStatus status={apiStatus} />}
        </nav>

        <div className="hero-content">
          <h1 className="hero-title">Find flights by aircraft type</h1>
          <p className="hero-subtitle">Search routes worldwide, filtered by aircraft model</p>
        </div>

        {filterOptions && (
          <div className="hero-search">
            <SearchForm
              onSearch={handleSearch}
              onExplore={handleExplore}
              filterOptions={filterOptions}
              prefillArrival={prefillArrival}
              onPrefillUsed={() => setPrefillArrival(null)}
            />
          </div>
        )}
      </section>

      <main className="results-section">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        {loading && (
          <div className="loading-state" role="status" aria-live="polite" aria-label={loadingMessage}>
            <div className="loading-spinner" aria-hidden="true" />
            <p className="loading-message">{loadingMessage}</p>
          </div>
        )}

        {!loading && exploreResults !== null && (
          <ExploreResults
            results={exploreResults}
            departure={exploreContext?.departure}
            aircraft={exploreContext?.aircraft}
            onSelect={handleSelectDestination}
          />
        )}

        {!loading && exploreResults === null && (
          <FlightResults flights={flights} source={apiSource} />
        )}
      </main>
    </div>
  );
}

export default App;

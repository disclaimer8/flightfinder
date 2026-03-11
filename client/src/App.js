import React, { useState, useEffect } from 'react';
import axios from 'axios';
import SearchForm from './components/SearchForm';
import FlightResults from './components/FlightResults';
import ExploreResults from './components/ExploreResults';
import APIStatus from './components/APIStatus';
import './App.css';

function App() {
  const [flights, setFlights] = useState([]);
  const [exploreResults, setExploreResults] = useState(null); // null = not in explore mode
  const [exploreContext, setExploreContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [filterOptions, setFilterOptions] = useState(null);
  const [apiSource, setApiSource] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);

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
    setLoading(true);
    setLoadingMessage('Searching flights…');
    try {
      const params = new URLSearchParams();
      if (filters.departure)   params.append('departure', filters.departure);
      if (filters.arrival)     params.append('arrival', filters.arrival);
      if (filters.date)        params.append('date', filters.date);
      if (filters.passengers)  params.append('passengers', filters.passengers);
      if (filters.aircraftType)  params.append('aircraftType', filters.aircraftType);
      if (filters.aircraftModel) params.append('aircraftModel', filters.aircraftModel);
      if (filters.returnDate)  params.append('returnDate', filters.returnDate);

      const response = await axios.get(`/api/flights?${params}`);
      setFlights(response.data.data || []);
      setApiSource(response.data.source);
    } catch (error) {
      console.error('Error searching flights:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExplore = async (params) => {
    setFlights([]);
    setLoading(true);
    setLoadingMessage('Scanning destinations… this may take a moment ✈️');
    try {
      const p = new URLSearchParams();
      p.append('departure', params.departure);
      if (params.date)          p.append('date', params.date);
      if (params.aircraftType)  p.append('aircraftType', params.aircraftType);
      if (params.aircraftModel) p.append('aircraftModel', params.aircraftModel);

      const response = await axios.get(`/api/flights/explore?${p}`);
      setExploreResults(response.data.data || []);

      // Resolve aircraft label for the header
      const ac = params.aircraftModel
        ? filterOptions?.aircraft?.find(a => a.code === params.aircraftModel)
        : params.aircraftType
          ? { name: params.aircraftType, type: params.aircraftType }
          : null;

      setExploreContext({ departure: params.departure, aircraft: ac });
    } catch (error) {
      console.error('Error exploring destinations:', error);
      setExploreResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>✈️ FlightFinder</h1>
        <p>Search flights by aircraft type and model</p>
        {apiStatus && <APIStatus status={apiStatus} />}
      </header>

      <main className="container">
        {filterOptions && (
          <SearchForm
            onSearch={handleSearch}
            onExplore={handleExplore}
            filterOptions={filterOptions}
          />
        )}

        {loading && <p className="loading">{loadingMessage}</p>}

        {!loading && exploreResults !== null && (
          <ExploreResults
            results={exploreResults}
            departure={exploreContext?.departure}
            aircraft={exploreContext?.aircraft}
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

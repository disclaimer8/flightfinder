import React, { useState, useEffect } from 'react';
import axios from 'axios';
import SearchForm from './components/SearchForm';
import FlightResults from './components/FlightResults';
import APIStatus from './components/APIStatus';
import './App.css';

function App() {
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState(null);
  const [apiSource, setApiSource] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);

  useEffect(() => {
    // Fetch filter options on load
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
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.departure) params.append('departure', filters.departure);
      if (filters.arrival) params.append('arrival', filters.arrival);
      if (filters.date) params.append('date', filters.date);
      if (filters.passengers) params.append('passengers', filters.passengers);
      if (filters.aircraftType) params.append('aircraftType', filters.aircraftType);
      if (filters.aircraftModel) params.append('aircraftModel', filters.aircraftModel);
      if (filters.returnDate) params.append('returnDate', filters.returnDate);

      const response = await axios.get(`/api/flights?${params}`);
      setFlights(response.data.data || []);
      setApiSource(response.data.source);
    } catch (error) {
      console.error('Error searching flights:', error);
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
            filterOptions={filterOptions}
          />
        )}

        {loading && <p className="loading">Searching flights...</p>}
        
        <FlightResults flights={flights} source={apiSource} />
      </main>
    </div>
  );
}

export default App;

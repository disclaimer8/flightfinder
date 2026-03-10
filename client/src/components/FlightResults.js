import React from 'react';
import FlightCard from './FlightCard';
import './FlightResults.css';

function FlightResults({ flights, source }) {
  return (
    <div className="results-container">
      {flights.length === 0 ? (
        <div className="no-results">
          <p>No flights found. Try adjusting your search criteria.</p>
        </div>
      ) : (
        <div className="flights-grid">
          <div className="results-header">
            <h2>Found {flights.length} flights</h2>
            {source && (
              <span className={`source-badge source-${source}`}>
                {source === 'amadeus' ? '🌍 Live Data' : '📋 Demo Data'}
              </span>
            )}
          </div>
          {flights.map(flight => (
            <FlightCard key={flight.id} flight={flight} />
          ))}
        </div>
      )}
    </div>
  );
}

export default FlightResults;

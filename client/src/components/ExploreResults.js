import React, { useState } from 'react';
import './ExploreResults.css';

const TYPE_ICONS = {
  'wide-body':  '✈️',
  'jet':        '🛫',
  'regional':   '🛩️',
  'turboprop':  '🚁',
};

const SORT_OPTIONS = [
  { id: 'price',    label: 'Cheapest' },
  { id: 'duration', label: 'Quickest' },
  { id: 'alpha',    label: 'A–Z' },
];

function parseDurationMins(str) {
  if (!str) return Infinity;
  const h = str.match(/(\d+)h/);
  const m = str.match(/(\d+)m/);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function ExploreResults({ results, departure, aircraft }) {
  const [sortBy, setSortBy] = useState('price');

  if (!results || results.length === 0) {
    return (
      <div className="explore-empty">
        <p>No destinations found for this aircraft from <strong>{departure}</strong>.</p>
        <p>Try a different aircraft type or date.</p>
      </div>
    );
  }

  const sorted = [...results].sort((a, b) => {
    if (sortBy === 'price')    return parseFloat(a.price) - parseFloat(b.price);
    if (sortBy === 'duration') return parseDurationMins(a.duration) - parseDurationMins(b.duration);
    if (sortBy === 'alpha')    return a.destination.city.localeCompare(b.destination.city);
    return 0;
  });

  const cheapest = Math.min(...results.map(r => parseFloat(r.price)));

  return (
    <div className="explore-results">
      <div className="explore-header">
        <div className="explore-summary">
          <span className="explore-count">{results.length} destinations</span>
          {aircraft && (
            <span className="explore-aircraft-tag">
              {TYPE_ICONS[aircraft.type] || '✈️'} {aircraft.name || aircraft.type}
            </span>
          )}
          <span className="explore-from">from <strong>{departure}</strong></span>
        </div>
        <div className="explore-sort">
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
      </div>

      <div className="destination-grid">
        {sorted.map((result, i) => {
          const { destination, price, currency, duration, stops, airline, aircraftName, aircraftType, departureTime, arrivalTime } = result;
          const isCheapest = parseFloat(price) === cheapest;

          return (
            <div key={i} className={`destination-card ${isCheapest ? 'cheapest' : ''}`}>
              {isCheapest && <span className="cheapest-tag">Best price</span>}

              <div className="dest-top">
                <span className="dest-flag">{destination.flag}</span>
                <div className="dest-name">
                  <span className="dest-city">{destination.city}</span>
                  <span className="dest-country">{destination.country}</span>
                </div>
                <span className="dest-code">{destination.code}</span>
              </div>

              <div className="dest-price">
                <span className="price-amount">
                  {currency === 'EUR' ? '€' : '$'}{parseFloat(price).toFixed(0)}
                </span>
                <span className="price-label">from</span>
              </div>

              <div className="dest-flight">
                <div className="dest-times">
                  <span>{formatTime(departureTime)}</span>
                  <span className="dest-arrow">→</span>
                  <span>{formatTime(arrivalTime)}</span>
                </div>
                <div className="dest-meta">
                  <span className="dest-duration">{duration}</span>
                  {stops === 0
                    ? <span className="nonstop-badge">Nonstop</span>
                    : <span className="stops-badge">{stops} stop{stops > 1 ? 's' : ''}</span>
                  }
                </div>
              </div>

              <div className="dest-footer">
                <span className="dest-airline">{airline}</span>
                <span className={`dest-aircraft type-${aircraftType}`}>
                  {TYPE_ICONS[aircraftType] || '✈️'} {aircraftName}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ExploreResults;

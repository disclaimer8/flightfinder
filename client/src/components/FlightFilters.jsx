import './FlightFilters.css';

const TIME_SLOTS = [
  { id: 'morning',   label: 'Morning',   sub: '06:00–12:00', icon: '🌅' },
  { id: 'afternoon', label: 'Afternoon', sub: '12:00–18:00', icon: '☀️' },
  { id: 'evening',   label: 'Evening',   sub: '18:00–24:00', icon: '🌆' },
  { id: 'night',     label: 'Night',     sub: '00:00–06:00', icon: '🌙' },
];

function getTimeSlot(isoString) {
  const h = new Date(isoString).getHours();
  if (h < 6)  return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function FlightFilters({ flights, filters, onChange }) {
  if (!flights.length) return null;

  const prices = flights.map(f => parseFloat(f.price)).filter(Boolean);
  const globalMin = Math.floor(Math.min(...prices));
  const globalMax = Math.ceil(Math.max(...prices));

  const airlines = [...new Set(flights.map(f => f.airline).filter(Boolean))].sort();

  const stopCounts = { 0: 0, 1: 0, '2+': 0 };
  flights.forEach(f => {
    const s = f.stops ?? 0;
    if (s === 0) stopCounts[0]++;
    else if (s === 1) stopCounts[1]++;
    else stopCounts['2+']++;
  });

  const toggle = (key, value) => {
    const cur = filters[key];
    const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
    onChange({ ...filters, [key]: next });
  };

  const hasActiveFilters =
    filters.stops.length > 0 ||
    filters.airlines.length > 0 ||
    filters.timeOfDay.length > 0 ||
    (filters.maxPrice !== null && filters.maxPrice < globalMax);

  const reset = () => onChange({
    stops: [],
    airlines: [],
    timeOfDay: [],
    maxPrice: null,
  });

  const maxPrice = filters.maxPrice ?? globalMax;

  return (
    <aside className="filters-panel">
      <div className="filters-header">
        <span className="filters-title">Filters</span>
        {hasActiveFilters && (
          <button className="filters-reset" onClick={reset}>Clear all</button>
        )}
      </div>

      {/* Stops */}
      <div className="filter-section">
        <h4 className="filter-label">Stops</h4>
        {[
          { val: 0,    label: 'Nonstop', count: stopCounts[0] },
          { val: 1,    label: '1 stop',  count: stopCounts[1] },
          { val: '2+', label: '2+ stops', count: stopCounts['2+'] },
        ].map(({ val, label, count }) => count > 0 && (
          <label key={val} className="filter-check">
            <input
              type="checkbox"
              checked={filters.stops.includes(val)}
              onChange={() => toggle('stops', val)}
            />
            <span className="check-label">{label}</span>
            <span className="check-count">{count}</span>
          </label>
        ))}
      </div>

      {/* Price */}
      <div className="filter-section">
        <h4 className="filter-label">
          Max price <span className="price-current-inline">{maxPrice} €</span>
        </h4>
        <div className="price-slider-wrap">
          <input
            type="range"
            min={globalMin}
            max={globalMax}
            value={maxPrice}
            step={5}
            className="price-slider"
            aria-label={`Maximum price: ${maxPrice} €`}
            aria-valuemin={globalMin}
            aria-valuemax={globalMax}
            aria-valuenow={maxPrice}
            onChange={e => onChange({ ...filters, maxPrice: +e.target.value })}
          />
          <div className="price-slider-labels">
            <span className="price-range-min">{globalMin} €</span>
            <span className="price-range-max">{globalMax} €</span>
          </div>
        </div>
      </div>

      {/* Departure time */}
      <div className="filter-section">
        <h4 className="filter-label">Departure time</h4>
        <div className="time-slots">
          {TIME_SLOTS.map(({ id, label, sub, icon }) => {
            const count = flights.filter(f => getTimeSlot(f.departureTime) === id).length;
            if (!count) return null;
            return (
              <button
                key={id}
                className={`time-slot-btn ${filters.timeOfDay.includes(id) ? 'active' : ''}`}
                aria-pressed={filters.timeOfDay.includes(id)}
                onClick={() => toggle('timeOfDay', id)}
              >
                <span className="ts-icon" aria-hidden="true">{icon}</span>
                <span className="ts-label">{label}</span>
                <span className="ts-sub">{sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Airlines */}
      {airlines.length > 1 && (
        <div className="filter-section">
          <h4 className="filter-label">Airlines</h4>
          {airlines.map(airline => {
            const count = flights.filter(f => f.airline === airline).length;
            return (
              <label key={airline} className="filter-check">
                <input
                  type="checkbox"
                  checked={filters.airlines.includes(airline)}
                  onChange={() => toggle('airlines', airline)}
                />
                <span className="check-label">{airline}</span>
                <span className="check-count">{count}</span>
              </label>
            );
          })}
        </div>
      )}
    </aside>
  );
}

export { getTimeSlot };
export default FlightFilters;

import { useState, useEffect } from 'react';
import './ValidityCalendar.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Returns an array of week rows (each row = 7 slots: [date|null, ...])
function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDay + 6) % 7; // shift to Monday-first

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7).concat(Array(7).fill(null)).slice(0, 7));
  }
  return weeks;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Mo','Tu','We','Th','Fr','Sa','Su'];

// Price → colour class
function priceClass(price, min, max) {
  if (price == null || min == null) return '';
  if (max === min) return 'vc-day--mid';
  const pct = (price - min) / (max - min);
  if (pct < 0.33) return 'vc-day--cheap';
  if (pct < 0.66) return 'vc-day--mid';
  return 'vc-day--expensive';
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ValidityCalendar({ origin, dest, onClose }) {
  const [calendar, setCalendar] = useState(null); // [{ date, price }]
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setCalendar(null);

    fetch(`/api/map/flight-dates?origin=${origin.iata}&destination=${dest.iata}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setCalendar(data.calendar || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [origin.iata, dest.iata]);

  // Build a Map<YYYY-MM-DD, price> for quick lookup
  const priceMap = new Map();
  if (calendar) {
    for (const entry of calendar) {
      if (entry.date && entry.price != null) priceMap.set(entry.date, entry.price);
    }
  }

  const prices = [...priceMap.values()];
  const minP   = prices.length ? Math.min(...prices) : null;
  const maxP   = prices.length ? Math.max(...prices) : null;

  // Show 12 months starting from today
  const now    = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  return (
    <div className="vc-overlay" role="dialog" aria-modal="true" aria-label={`Flight calendar ${origin.iata} to ${dest.iata}`}>
      <div className="vc-panel">
        {/* Header */}
        <div className="vc-header">
          <div className="vc-route">
            <span className="vc-iata">{origin.iata}</span>
            <span className="vc-arrow">→</span>
            <span className="vc-iata">{dest.iata}</span>
            {origin.city && dest.city && (
              <span className="vc-cities">{origin.city} → {dest.city}</span>
            )}
          </div>
          <button className="vc-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* Legend */}
        <div className="vc-legend">
          <span className="vc-legend-dot vc-day--cheap"  />Cheap
          <span className="vc-legend-dot vc-day--mid"    />Mid
          <span className="vc-legend-dot vc-day--expensive" />Expensive
        </div>

        {/* Body */}
        <div className="vc-body">
          {loading && <p className="vc-msg">Loading calendar…</p>}
          {error   && <p className="vc-msg vc-msg--err">{error}</p>}

          {!loading && !error && priceMap.size === 0 && (
            <p className="vc-msg">No price data available for this route in the test environment.</p>
          )}

          {!loading && !error && (
            <div className="vc-months">
              {months.map(({ year, month }) => {
                const weeks = buildMonthGrid(year, month);
                const label = `${MONTH_NAMES[month]} ${year}`;
                return (
                  <div key={label} className="vc-month">
                    <div className="vc-month-name">{label}</div>
                    <div className="vc-grid">
                      {/* Day headers */}
                      {DAY_NAMES.map(d => (
                        <div key={d} className="vc-day-hdr">{d}</div>
                      ))}
                      {/* Day cells */}
                      {weeks.flat().map((day, i) => {
                        if (day == null) return <div key={i} className="vc-day vc-day--empty" />;
                        const iso   = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                        const price = priceMap.get(iso);
                        const cls   = priceClass(price, minP, maxP);
                        return (
                          <div
                            key={i}
                            className={`vc-day ${cls}`}
                            title={price != null ? `$${price.toFixed(0)}` : iso}
                          >
                            {day}
                            {price != null && <span className="vc-day-price">${Math.round(price)}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

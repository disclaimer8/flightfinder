import { useState, useMemo } from 'react';
import './PriceCalendar.css';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function bucketFor(price, min, max) {
  const span = max - min || 1;
  const t1 = min + span * 0.34;
  const t2 = min + span * 0.67;
  if (price <= t1) return 'low';
  if (price <= t2) return 'mid';
  return 'high';
}

function fmtDate(start, offset) {
  const d = new Date(start);
  d.setDate(d.getDate() + offset);
  return {
    dow:  DOW[(d.getDay() + 6) % 7],   // ISO Mon=0
    day:  d.getDate(),
    full: d.toDateString().slice(0, 15),
  };
}

/**
 * 14-day price bar chart.
 *
 * Props:
 *   prices:     number[14]    — daily fares, USD
 *   startDate:  Date | string — first day represented by prices[0]
 *   route:      string        — e.g. "LHR → JFK" (header)
 *   cabin:      string        — "economy" | "business" (header subtitle)
 *   onSelect:   (date, price) => void — fires on click (day cell)
 */
export default function PriceCalendar({
  prices = [],
  startDate,
  route,
  cabin = 'economy',
  onSelect,
}) {
  const start = useMemo(
    () => (startDate instanceof Date ? startDate : new Date(startDate || Date.now())),
    [startDate],
  );

  const stats = useMemo(() => {
    if (!prices.length) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    return { min, max, avg, cheapestIdx: prices.indexOf(min) };
  }, [prices]);

  const [selectedIdx, setSelectedIdx] = useState(() => prices.indexOf(Math.min(...prices)));

  if (!stats) return null;
  const { min, max, avg, cheapestIdx } = stats;
  const selectedPrice = prices[selectedIdx];
  const diff = selectedPrice - min;
  const selDate = fmtDate(start, selectedIdx);
  const cheapDate = fmtDate(start, cheapestIdx);

  const handleClick = (i) => {
    setSelectedIdx(i);
    if (onSelect) onSelect(fmtDate(start, i), prices[i]);
  };

  return (
    <div className="pcal">
      <div className="pcal__hdr">
        <h2 className="pcal__title">{route ? `Prices · ${route}` : 'Price calendar'}</h2>
        <div className="pcal__sub">{prices.length} days · {cabin}</div>
      </div>

      <div className="pcal__legend" aria-hidden="true">
        <span className="pcal__legend-low">Low</span>
        <span className="pcal__legend-mid">Mid</span>
        <span className="pcal__legend-high">High</span>
        <span className="pcal__legend-sel">Selected</span>
      </div>

      <div className="pcal__chart" role="list">
        {prices.map((p, i) => {
          const b = bucketFor(p, min, max);
          const heightPct = 25 + ((p - min) / (max - min || 1)) * 75;
          const date = fmtDate(start, i);
          const cls = [
            'pcal__day',
            `is-${b}`,
            i === selectedIdx ? 'is-selected' : '',
            i === cheapestIdx ? 'is-cheapest' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={i}
              type="button"
              className={cls}
              onClick={() => handleClick(i)}
              role="listitem"
              aria-pressed={i === selectedIdx}
              aria-label={`${date.full}: $${p}`}
            >
              <div className="pcal__bar">
                <div className="pcal__bar-fill" style={{ height: `${heightPct}%` }} />
              </div>
              <div className="pcal__price">${p}</div>
              <div className="pcal__date">{date.dow} {date.day}</div>
            </button>
          );
        })}
      </div>

      <div className="pcal__hint">
        {diff === 0
          ? <><b>{selDate.dow} {selDate.day}</b> — cheapest day in window (${selectedPrice}).</>
          : <>On <b>{selDate.dow} {selDate.day}</b> the fare is ${selectedPrice}. Shift to <b>{cheapDate.dow} {cheapDate.day}</b> to save <b>${diff}</b>.</>}
      </div>

      <div className="pcal__summary">
        <div className="pcal__cell">
          <div className="pcal__cell-l">Cheapest</div>
          <div className="pcal__cell-v">${min}<small> · {cheapDate.dow} {cheapDate.day}</small></div>
        </div>
        <div className="pcal__cell">
          <div className="pcal__cell-l">Average</div>
          <div className="pcal__cell-v">${avg}<small> / day</small></div>
        </div>
        <div className="pcal__cell">
          <div className="pcal__cell-l">Selected</div>
          <div className="pcal__cell-v">${selectedPrice}<small> · {selDate.full}</small></div>
        </div>
      </div>
    </div>
  );
}

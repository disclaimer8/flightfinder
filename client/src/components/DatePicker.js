import React, { useState, useEffect, useRef } from 'react';
import './DatePicker.css';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function toLocal(dateStr) {
  // Avoid timezone shift: parse as local noon
  return dateStr ? new Date(dateStr + 'T12:00:00') : null;
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplay(dateStr) {
  if (!dateStr) return null;
  const d = toLocal(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function DatePicker({ value, onChange, min, placeholder = 'Select date', label }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = value ? toLocal(value) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const minDate = min ? toLocal(min) : null;
  const selected = value ? toLocal(value) : null;

  // Build days grid (Mon-start)
  const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
  const lastOfMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0);
  let offset = firstOfMonth.getDay() - 1;
  if (offset < 0) offset = 6;

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  }
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  const isDisabled = (d) => minDate && d < minDate;
  const isSelected = (d) => selected && d.toDateString() === selected.toDateString();
  const isToday = (d) => d.toDateString() === new Date().toDateString();

  const select = (day) => {
    if (!day || isDisabled(day)) return;
    onChange(toISO(day));
    setOpen(false);
  };

  const prevMonth = () => setView(v => new Date(v.getFullYear(), v.getMonth() - 1, 1));
  const nextMonth = () => setView(v => new Date(v.getFullYear(), v.getMonth() + 1, 1));

  const canPrev = !minDate || new Date(view.getFullYear(), view.getMonth(), 0) >= minDate;

  return (
    <div className="dp-wrap" ref={ref}>
      {label && <label className="dp-label">{label}</label>}
      <button
        type="button"
        className={`dp-trigger${open ? ' dp-open' : ''}${value ? '' : ' dp-empty'}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="dp-icon">✈</span>
        <span className="dp-value">{formatDisplay(value) || placeholder}</span>
        <span className="dp-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="dp-popup">
          <div className="dp-header">
            <button type="button" className="dp-nav" onClick={prevMonth} disabled={!canPrev}>‹</button>
            <span className="dp-month-label">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
            <button type="button" className="dp-nav" onClick={nextMonth}>›</button>
          </div>

          <div className="dp-grid">
            {DAYS.map(d => <div key={d} className="dp-day-name">{d}</div>)}
            {cells.map((day, i) => (
              <div
                key={i}
                className={[
                  'dp-cell',
                  !day ? 'dp-empty' : '',
                  day && isDisabled(day) ? 'dp-disabled' : '',
                  day && isSelected(day) ? 'dp-selected' : '',
                  day && isToday(day) && !isSelected(day) ? 'dp-today' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => select(day)}
              >
                {day ? day.getDate() : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default DatePicker;

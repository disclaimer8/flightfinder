import { useState, useEffect, useRef } from 'react';
import { MONTHS } from '../utils/constants';
import './DatePicker.css';

const DAYS_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAYS_FULL  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

function toLocal(dateStr) {
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

function formatAriaLabel(day) {
  return day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function getFocusable(container) {
  return Array.from(
    container.querySelectorAll(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

function DatePicker({ value, onChange, min, placeholder = 'Select date', label, align = 'left' }) {
  const [open, setOpen]           = useState(false);
  const [view, setView]           = useState(() => {
    const base = value ? toLocal(value) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [focusedDate, setFocusedDate] = useState(null);

  const wrapRef    = useRef(null);
  const popupRef   = useRef(null);
  const gridRef    = useRef(null);
  const triggerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // When popup opens: initialise focusedDate, scroll view, trap focus
  useEffect(() => {
    if (!open) return;
    const initial = value ? toLocal(value) : new Date();
    setView(new Date(initial.getFullYear(), initial.getMonth(), 1));
    setFocusedDate(initial);

    const popup = popupRef.current;
    if (!popup) return;

    const trapKeyDown = (e) => {
      if (e.key === 'Tab') {
        const items = getFocusable(popup);
        if (!items.length) return;
        const first = items[0];
        const last  = items[items.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };

    popup.addEventListener('keydown', trapKeyDown);
    return () => popup.removeEventListener('keydown', trapKeyDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move DOM focus to the currently focused date cell
  useEffect(() => {
    if (open && focusedDate && gridRef.current) {
      const cell = gridRef.current.querySelector('[tabindex="0"]');
      if (cell) cell.focus();
    }
  }, [focusedDate, open]);

  const minDate = min ? toLocal(min) : null;
  const selected = value ? toLocal(value) : null;

  // Build days grid (Mon-start)
  const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
  const lastOfMonth  = new Date(view.getFullYear(), view.getMonth() + 1, 0);
  let offset = firstOfMonth.getDay() - 1;
  if (offset < 0) offset = 6;

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const isDisabled = (d) => minDate && d < minDate;
  const isSelected = (d) => selected && d.toDateString() === selected.toDateString();
  const isToday    = (d) => d.toDateString() === new Date().toDateString();
  const isFocused  = (d) => focusedDate && d.toDateString() === focusedDate.toDateString();

  const select = (day) => {
    if (!day || isDisabled(day)) return;
    onChange(toISO(day));
    setOpen(false);
    // Return focus to trigger
    if (triggerRef.current) triggerRef.current.focus();
  };

  const prevMonth = () => setView(v => new Date(v.getFullYear(), v.getMonth() - 1, 1));
  const nextMonth = () => setView(v => new Date(v.getFullYear(), v.getMonth() + 1, 1));

  const canPrev = !minDate || new Date(view.getFullYear(), view.getMonth(), 0) >= minDate;

  const navigateFocus = (delta) => {
    const base = focusedDate || (value ? toLocal(value) : new Date());
    const next = new Date(base);
    next.setDate(next.getDate() + delta);
    if (next.getMonth() !== view.getMonth() || next.getFullYear() !== view.getFullYear()) {
      setView(new Date(next.getFullYear(), next.getMonth(), 1));
    }
    setFocusedDate(next);
  };

  const handleGridKeyDown = (e) => {
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); navigateFocus(-1);  break;
      case 'ArrowRight': e.preventDefault(); navigateFocus(1);   break;
      case 'ArrowUp':    e.preventDefault(); navigateFocus(-7);  break;
      case 'ArrowDown':  e.preventDefault(); navigateFocus(7);   break;
      case 'PageUp':     e.preventDefault(); prevMonth();         break;
      case 'PageDown':   e.preventDefault(); nextMonth();         break;
      case 'Home':       e.preventDefault(); navigateFocus(-(focusedDate?.getDay() - 1 || 0)); break;
      case 'End':        e.preventDefault(); navigateFocus(7 - (focusedDate?.getDay() || 7));  break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedDate && !isDisabled(focusedDate)) select(focusedDate);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        if (triggerRef.current) triggerRef.current.focus();
        break;
      default: break;
    }
  };

  const triggerId = label
    ? `dp-trigger-${label.replace(/\s+/g, '-').toLowerCase()}`
    : 'dp-trigger';

  const monthLabel = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;

  return (
    <div className={`dp-wrap${align === 'right' ? ' dp-align-right' : ''}`} ref={wrapRef}>
      {label && <label className="dp-label" htmlFor={triggerId}>{label}</label>}
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        className={`dp-trigger${open ? ' dp-open' : ''}${value ? '' : ' dp-empty'}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label || 'Date'}: ${formatDisplay(value) || placeholder}`}
      >
        <svg aria-hidden="true" focusable="false" className="dp-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M2 7h12" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className="dp-value">{formatDisplay(value) || placeholder}</span>
        <span className="dp-arrow" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="dp-popup"
          role="dialog"
          aria-label={`Choose ${label || 'date'}`}
          aria-modal="true"
          ref={popupRef}
        >
          <div className="dp-header">
            <button
              type="button"
              className="dp-nav"
              onClick={prevMonth}
              disabled={!canPrev}
              aria-label="Previous month"
            >‹</button>
            <span
              className="dp-month-label"
              aria-live="polite"
              aria-atomic="true"
            >
              {monthLabel}
            </span>
            <button
              type="button"
              className="dp-nav"
              onClick={nextMonth}
              aria-label="Next month"
            >›</button>
          </div>

          <div
            className="dp-grid"
            role="grid"
            aria-label={monthLabel}
            ref={gridRef}
            onKeyDown={handleGridKeyDown}
          >
            <div role="row" className="dp-week-row">
              {DAYS_SHORT.map((d, i) => (
                <div key={d} role="columnheader" className="dp-day-name" aria-label={DAYS_FULL[i]}>
                  {d}
                </div>
              ))}
            </div>

            {weeks.map((week, wi) => (
              <div key={wi} role="row" className="dp-week-row">
                {week.map((day, ci) => (
                  <div
                    key={ci}
                    role="gridcell"
                    className={[
                      'dp-cell',
                      !day ? 'dp-empty' : '',
                      day && isDisabled(day) ? 'dp-disabled' : '',
                      day && isSelected(day) ? 'dp-selected' : '',
                      day && isToday(day) && !isSelected(day) ? 'dp-today' : '',
                      day && isFocused(day) ? 'dp-focused' : '',
                    ].filter(Boolean).join(' ')}
                    tabIndex={day && isFocused(day) ? 0 : -1}
                    aria-label={day ? formatAriaLabel(day) : undefined}
                    aria-selected={day ? isSelected(day) : undefined}
                    aria-disabled={day && isDisabled(day) ? true : undefined}
                    onClick={() => select(day)}
                    onMouseEnter={() => day && !isDisabled(day) && setFocusedDate(day)}
                  >
                    {day ? day.getDate() : ''}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <p className="dp-hint">
            Arrow keys to navigate · Enter to select · Esc to close
          </p>
        </div>
      )}
    </div>
  );
}

export default DatePicker;

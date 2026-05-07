import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULTS, serializeSearchParams } from '../utils/searchParams';
import './HomeSearchBar.css';

/**
 * Hero search bar on the Home page.
 * Captures from / to / depart / return / pax / direct / flexDates,
 * validates, then navigates to /search?... without calling any API.
 * cabin defaults to 'economy' on submit (advanced option lives on /search).
 */
export default function HomeSearchBar() {
  const navigate = useNavigate();

  const [from,      setFrom]      = useState('');
  const [to,        setTo]        = useState('');
  const [date,      setDate]      = useState('');
  const [returnDate,setReturnDate]= useState('');
  const [pax,       setPax]       = useState(DEFAULTS.pax);
  const [direct,    setDirect]    = useState(false);
  const [flexDates, setFlexDates] = useState(false);
  const [error,     setError]     = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!from || !to || !date) {
      setError('Please fill in From, To, and Depart fields.');
      return;
    }
    if (from === to) {
      setError('Origin and destination must be different.');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    if (date < today) {
      setError('Departure date cannot be in the past.');
      return;
    }
    if (returnDate && returnDate < date) {
      setError('Return date must be on or after the departure date.');
      return;
    }

    const qs = serializeSearchParams({
      ...DEFAULTS,
      from,
      to,
      date,
      return: returnDate,
      pax,
      cabin: DEFAULTS.cabin,
      flexDates,
      aircraft: [],
      airlines: [],
      direct,
      sort: DEFAULTS.sort,
      shown: DEFAULTS.shown,
    });

    navigate(`/search?${qs}`);
  };

  return (
    <form
      className="home-search-bar"
      onSubmit={handleSubmit}
      aria-label="Flight search"
      noValidate
    >
      {error && (
        <p className="hsb-error" role="alert">{error}</p>
      )}

      <div className="hsb-fields">
        <label className="hsb-field">
          <span className="hsb-label">From</span>
          <input
            type="text"
            aria-label="From"
            value={from}
            onChange={e => setFrom(e.target.value.toUpperCase().slice(0, 3))}
            maxLength={3}
            placeholder="LHR"
            autoComplete="off"
          />
        </label>

        <label className="hsb-field">
          <span className="hsb-label">To</span>
          <input
            type="text"
            aria-label="To"
            value={to}
            onChange={e => setTo(e.target.value.toUpperCase().slice(0, 3))}
            maxLength={3}
            placeholder="JFK"
            autoComplete="off"
          />
        </label>

        <label className="hsb-field">
          <span className="hsb-label">Depart</span>
          <input
            type="date"
            aria-label="Depart"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={e => setDate(e.target.value)}
          />
        </label>

        <label className="hsb-field">
          <span className="hsb-label">Return</span>
          <input
            type="date"
            aria-label="Return"
            value={returnDate}
            onChange={e => setReturnDate(e.target.value)}
            min={date || undefined}
          />
        </label>

        <label className="hsb-field hsb-field--pax">
          <span className="hsb-label">Passengers</span>
          <select
            aria-label="Passengers"
            value={pax}
            onChange={e => setPax(parseInt(e.target.value, 10))}
          >
            {[1,2,3,4,5,6,7,8,9].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <button type="submit" className="hsb-submit">
          Search flights
        </button>
      </div>

      <div className="hsb-checkboxes">
        <label className="hsb-checkbox">
          <input
            type="checkbox"
            aria-label="Direct only"
            checked={direct}
            onChange={e => setDirect(e.target.checked)}
          />
          Direct only
        </label>

        <label className="hsb-checkbox">
          <input
            type="checkbox"
            aria-label="Flexible dates (±3 days)"
            checked={flexDates}
            onChange={e => setFlexDates(e.target.checked)}
          />
          ±3 day flexibility
        </label>
      </div>
    </form>
  );
}

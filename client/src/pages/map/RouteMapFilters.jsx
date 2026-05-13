import { useState, useEffect, useId } from 'react';
import styles from './Map.module.css';

/**
 * RouteMapFilters
 *
 * Two datalist-backed search inputs — one for airline, one for aircraft type.
 * Uses HTML-native <datalist> for typeahead — no extra deps.
 *
 * Props:
 *   airline      {string|null}               Currently selected airline IATA code
 *   aircraft     {string|null}               Currently selected aircraft ICAO code
 *   airlines     {Array<{iata,name,count}>}  Options for the airline input
 *   aircraftList {Array<{icao,label,count}>} Options for the aircraft input
 *   onChange     {({airline, aircraft}) => void}
 */
export default function RouteMapFilters({
  airline,
  aircraft,
  airlines = [],
  aircraftList = [],
  onChange,
}) {
  const uid = useId();
  const airlineListId  = `${uid}-airline-list`;
  const aircraftListId = `${uid}-aircraft-list`;

  // Display text tracked in local state so typing mid-resolve doesn't clear
  // the field. Seeded from the resolved display name for the current code.
  const resolvedAirlineName  = airline  ? (airlines.find(a => a.iata === airline)?.name   ?? airline)  : '';
  const resolvedAircraftName = aircraft ? (aircraftList.find(a => a.icao === aircraft)?.label ?? aircraft) : '';

  const [airlineInput,  setAirlineInput]  = useState(resolvedAirlineName);
  const [aircraftInput, setAircraftInput] = useState(resolvedAircraftName);

  // Sync display text if parent drives a new selection (e.g. URL-driven load,
  // external reset). useEffect avoids calling setState during render.
  const [prevAirlineCode,  setPrevAirlineCode]  = useState(airline);
  const [prevAircraftCode, setPrevAircraftCode] = useState(aircraft);

  useEffect(() => {
    if (airline === prevAirlineCode) return;
    setPrevAirlineCode(airline);
    setAirlineInput(airline ? (airlines.find(a => a.iata === airline)?.name ?? airline) : '');
  }, [airline, airlines]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (aircraft === prevAircraftCode) return;
    setPrevAircraftCode(aircraft);
    setAircraftInput(aircraft ? (aircraftList.find(a => a.icao === aircraft)?.label ?? aircraft) : '');
  }, [aircraft, aircraftList]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ────────────────────────────────────────────────────────

  function handleAirlineChange(e) {
    const val = e.target.value;
    setAirlineInput(val);

    if (!val) {
      // Cleared via keyboard
      onChange({ airline: null, aircraft });
      return;
    }

    // Exact match resolution — case-insensitive on name and IATA code
    const lower = val.toLowerCase();
    const match = airlines.find(
      a => a.name.toLowerCase() === lower || a.iata.toLowerCase() === lower
    );
    if (match) {
      onChange({ airline: match.iata, aircraft });
    }
    // If no exact match, user is still typing — don't fire onChange
  }

  function handleAircraftChange(e) {
    const val = e.target.value;
    setAircraftInput(val);

    if (!val) {
      onChange({ airline, aircraft: null });
      return;
    }

    const lower = val.toLowerCase();
    const match = aircraftList.find(
      a => a.label.toLowerCase() === lower || a.icao.toLowerCase() === lower
    );
    if (match) {
      onChange({ airline, aircraft: match.icao });
    }
  }

  function clearAirline() {
    setAirlineInput('');
    onChange({ airline: null, aircraft });
  }

  function clearAircraft() {
    setAircraftInput('');
    onChange({ airline, aircraft: null });
  }

  return (
    <div className={styles.filterRow} role="search" aria-label="Route filters">

      {/* ── Airline filter ── */}
      <div className={styles.field}>
        <label htmlFor={`${uid}-airline`}>Airline</label>
        <input
          id={`${uid}-airline`}
          type="search"
          list={airlineListId}
          value={airlineInput}
          onChange={handleAirlineChange}
          placeholder="Filter by airline"
          autoComplete="off"
          aria-label="Filter by airline"
        />
        <datalist id={airlineListId}>
          {airlines.map(a => (
            <option key={a.iata} value={a.name}>
              {a.iata} · {a.count} routes
            </option>
          ))}
        </datalist>
        {airline && (
          <button
            type="button"
            className={styles.clear}
            onClick={clearAirline}
            aria-label="Clear airline filter"
          >
            ×
          </button>
        )}
      </div>

      {/* ── Aircraft type filter ── */}
      <div className={styles.field}>
        <label htmlFor={`${uid}-aircraft`}>Aircraft type</label>
        <input
          id={`${uid}-aircraft`}
          type="search"
          list={aircraftListId}
          value={aircraftInput}
          onChange={handleAircraftChange}
          placeholder="Filter by aircraft type"
          autoComplete="off"
          aria-label="Filter by aircraft type"
        />
        <datalist id={aircraftListId}>
          {aircraftList.map(a => (
            <option key={a.icao} value={a.label}>
              {a.icao} · {a.count} routes
            </option>
          ))}
        </datalist>
        {aircraft && (
          <button
            type="button"
            className={styles.clear}
            onClick={clearAircraft}
            aria-label="Clear aircraft filter"
          >
            ×
          </button>
        )}
      </div>

    </div>
  );
}

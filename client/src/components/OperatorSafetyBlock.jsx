import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOperator, fetchGlobalOperatorsCached } from '../pages/safety/safetyApi';
import { useAuth } from '../context/AuthContext';
import './OperatorSafetyBlock.css';

// Match an airline display name (or IATA/ICAO code) against the AirCrash
// `operator` field. AirCrash stores marketing names like "Delta Airlines"
// while the flight payload may give us "Delta Air Lines" or "DL". Strategy:
// 1. Exact case-insensitive equality.
// 2. Substring match in either direction (handles "Air France" vs
//    "Air France-KLM").
// We guard against pathologically short queries (≤2 chars) which would
// over-match. Returns the matched row or null.
function matchGlobalOperator(rows, airlineName, code) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const candidates = [airlineName, code]
    .filter(Boolean)
    .map(s => String(s).trim().toLowerCase())
    .filter(s => s.length >= 3);
  if (candidates.length === 0) return null;
  for (const row of rows) {
    if (!row?.name) continue;
    const r = String(row.name).toLowerCase();
    for (const q of candidates) {
      if (r === q || r.includes(q) || q.includes(r)) return row;
    }
  }
  return null;
}

export default function OperatorSafetyBlock({ airlineIata, airlineIcao, airlineName }) {
  const code = airlineIata || airlineIcao;
  const { getToken } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  // Global (AirCrash) operator stats — module-level cached so we hit the
  // network once per session even when N FlightCards mount simultaneously.
  const [globalOps, setGlobalOps] = useState(null);

  useEffect(() => {
    if (!code) return;
    let active = true;
    fetchOperator(code, getToken?.() || null)
      .then(r => { if (active) setData(r); })
      .catch(()  => { if (active) setError(true); });
    return () => { active = false; };
  }, [code, getToken]);

  useEffect(() => {
    let active = true;
    fetchGlobalOperatorsCached()
      .then(rows => { if (active) setGlobalOps(rows); })
      .catch(() => { /* graceful: section just won't render */ });
    return () => { active = false; };
  }, []);

  const globalMatch = useMemo(
    () => matchGlobalOperator(globalOps, airlineName, code),
    [globalOps, airlineName, code]
  );

  // Render nothing only when we have neither NTSB nor global data and the
  // operator isn't identifiable. If we have a global match we still want to
  // show that section even if NTSB returned an error.
  if (!code && !globalMatch) return null;
  if (error && !globalMatch) return null;
  if (!data && !globalMatch) return null;

  const coverage = data?.coverage || 'unknown';
  const counts = data?.counts || {};
  const total = counts.total || 0;
  const fatal = counts.fatal || 0;

  // Reusable global-history sub-block. Lifetime accident count is a different
  // thing from the 90-day NTSB rate above — we label it explicitly as
  // "historical" and link to the full dataset so users can self-contextualise.
  // Source attribution is in the linked /safety/global page footer; we keep
  // this row minimal to avoid overwhelming the card.
  const renderGlobalRow = () => {
    if (!globalMatch) return null;
    return (
      <div className="operator-safety__row operator-safety__row--global">
        <span className="operator-safety__label">Historical accidents on file</span>
        <span className="operator-safety__count">
          {globalMatch.count}
        </span>
        <Link
          to="/safety/global"
          className="operator-safety__link operator-safety__link--global"
          rel="nofollow"
        >
          See dataset →
        </Link>
      </div>
    );
  };

  // Branch 1: NTSB returned but coverage is non-US. Honest "unavailable" for
  // the recent rate; still show the global historical row when we matched it.
  if (data && coverage !== 'us-ntsb') {
    return (
      <div className="operator-safety">
        <div className="operator-safety--unavailable">
          <span className="operator-safety__label">Recent (US NTSB)</span>
          <span className="operator-safety__muted">Unavailable for this operator</span>
          <Link to="/legal/attributions" className="operator-safety__link" rel="nofollow">
            Why?
          </Link>
        </div>
        {renderGlobalRow()}
      </div>
    );
  }

  // Branch 2: NTSB unavailable entirely (error/missing) but we did match the
  // operator in AirCrash — render the global row only.
  if (!data && globalMatch) {
    return (
      <div className="operator-safety">
        {renderGlobalRow()}
      </div>
    );
  }

  // Branch 3: NTSB success path (US carrier).
  return (
    <div className="operator-safety">
      <div className="operator-safety__row">
        <span className="operator-safety__label">90-day safety record (US NTSB)</span>
        <span className={`operator-safety__count${fatal > 0 ? ' operator-safety__count--fatal' : ''}`}>
          {fatal > 0 && <strong>{fatal} fatal · </strong>}
          {total} total
        </span>
      </div>
      {data.proStats?.recentEvents?.[0] && (
        <p className="operator-safety__teaser">
          Latest: <strong>{data.proStats.recentEvents[0].cicttLabel}</strong>
          {' '}({new Date(data.proStats.recentEvents[0].occurredAt).toISOString().slice(0,10)})
        </p>
      )}
      {renderGlobalRow()}
      <Link to={`/safety/feed?operator=${encodeURIComponent(code)}`} className="operator-safety__link">
        View full safety history →
      </Link>
    </div>
  );
}

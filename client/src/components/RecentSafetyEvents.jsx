import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import './RecentSafetyEvents.css';

function dash(v) { return v == null || v === '' ? '—' : v; }

// The /api/safety/global/accidents endpoint is served by the Go sidecar
// (bin/aircrash-sidecar). Its row shape is {id, date, aircraft_model,
// operator, fatalities, location, source_url, lat, lon} — no severity,
// no tail, no dep/arr ICAO. The columns below mirror that contract.
function fatalitiesCell(raw) {
  if (raw == null) return '—';
  const s = String(raw).trim();
  if (s === '' || s === '0' || /^unknown$/i.test(s)) return '—';
  return s;
}

export default function RecentSafetyEvents() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/safety/global/accidents?limit=5`)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(body => {
        if (!active) return;
        const data = Array.isArray(body?.data) ? body.data : [];
        if (data.length < 1) setError(true);
        else setRows(data.slice(0, 5));
      })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  if (error || (rows && rows.length === 0)) {
    return (
      <section className="rse">
        <div className="rse-head">
          <span className="eyebrow eyebrow--strong">RECENT SAFETY EVENTS</span>
          <Link to="/safety/global" className="rse-all">Browse the full safety database →</Link>
        </div>
      </section>
    );
  }

  if (!rows) {
    return (
      <section className="rse">
        <div className="rse-head">
          <span className="eyebrow eyebrow--strong">RECENT SAFETY EVENTS</span>
        </div>
        <div className="rse-loading">Loading…</div>
      </section>
    );
  }

  return (
    <section className="rse">
      <div className="rse-head">
        <span className="eyebrow eyebrow--strong">RECENT SAFETY EVENTS</span>
        <Link to="/safety/global" className="rse-all">View all events →</Link>
      </div>
      <table className="rse-table">
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              <td className="rse-date">{dash(r.date)}</td>
              <td className="rse-operator">{dash(r.operator)}</td>
              <td className="rse-aircraft">{dash(r.aircraft_model)}</td>
              <td className="rse-location">{dash(r.location)}</td>
              <td className="rse-fatalities">{fatalitiesCell(r.fatalities)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

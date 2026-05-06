import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import './RecentSafetyEvents.css';

const SEVERITY_LABEL = {
  fatal:            'Fatal accident',
  hull_loss:        'Hull loss',
  serious_incident: 'Serious incident',
  incident:         'Incident',
  minor:            'Minor',
};

const SEVERITY_CLASS = {
  fatal:            'sev-fatal',
  hull_loss:        'sev-hull',
  serious_incident: 'sev-hull',
  incident:         'sev-incident',
  minor:            'sev-incident',
};

function dash(v) { return v == null || v === '' ? '—' : v; }

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
            <tr key={i}>
              <td className="rse-date">{dash(r.date)}</td>
              <td className={`rse-sev ${SEVERITY_CLASS[r.severity] ?? 'sev-incident'}`}>
                {SEVERITY_LABEL[r.severity] ?? dash(r.severity)}
              </td>
              <td className="rse-aircraft">{dash(r.aircraft_model)}</td>
              <td className="rse-tail">{dash(r.tail)}</td>
              <td className="rse-route">
                <span>{dash(r.from)}</span>
                <span className="rse-arrow"> → </span>
                <span>{dash(r.to)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

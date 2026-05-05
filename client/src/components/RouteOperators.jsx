import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import './RouteOperators.css';

export default function RouteOperators({ from, to }) {
  const [ops, setOps] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    let active = true;
    fetch(`${API_BASE}/api/map/route-operators?dep=${from}&arr=${to}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(body => {
        if (!active) return;
        const list = Array.isArray(body?.operators) ? body.operators : [];
        if (list.length === 0) setError(true);
        else setOps(list);
      })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [from, to]);

  if (error) return null;
  if (!ops) {
    return (
      <section className="route-ops" aria-busy="true">
        <div className="route-ops__loading">Loading operators…</div>
      </section>
    );
  }

  return (
    <section className="route-ops" aria-label="Operators on this route">
      <div className="route-ops__head">
        <span className="route-ops__eyebrow">OPERATORS ON THIS ROUTE</span>
        <span className="route-ops__sub">Last 90 days · top {ops.length}</span>
      </div>
      <table className="route-ops__table">
        <tbody>
          {ops.map(op => {
            const code = op.iata || op.icao;
            return (
              <tr key={code}>
                <td className="route-ops__name">{op.name || code}</td>
                <td className="route-ops__count">{op.count} flights</td>
                <td className="route-ops__safety">
                  {op.safetyCount90d > 0 ? (
                    <Link to={`/safety/global?op=${encodeURIComponent(code)}`} className="route-ops__safety-link">
                      {op.safetyCount90d} safety event{op.safetyCount90d === 1 ? '' : 's'} →
                    </Link>
                  ) : (
                    <span className="route-ops__safety-none">No recorded events</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { API_BASE } from '../utils/api';
import './AccidentDetail.css';

export default function AccidentDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/accidents/${slug}`)
      .then(async r => {
        if (r.status === 410) { navigate('/safety/global', { replace: true }); return null; }
        if (r.status === 404) { setError('not-found'); return null; }
        if (!r.ok)            { setError('http-error'); return null; }
        return r.json();
      })
      .then(body => { if (active && body) setData(body); })
      .catch(() => { if (active) setError('network'); });
    return () => { active = false; };
  }, [slug, navigate]);

  if (error === 'not-found') return <div className="ad-error">Accident not found.</div>;
  if (error)                 return <div className="ad-error">Could not load accident details.</div>;
  if (!data)                 return <div className="ad-loading">Loading…</div>;

  const f = data.facts || {};
  return (
    <main className="ad-page">
      <nav className="ad-crumbs">
        <Link to="/">Home</Link> → <Link to="/safety/global">Safety</Link> → Accident
      </nav>
      <header className="ad-hero">
        <h1>{f.date}: {f.aircraft_model}{f.operator ? ` — ${f.operator}` : ''}</h1>
        <p className="ad-meta">
          {(() => {
            const n = parseInt(String(f.fatalities ?? '').split('+').reduce((a, b) => a + (Number(b) || 0), 0), 10);
            const isFatal = n > 0;
            const sev = isFatal ? 'fatal' : (f.fatalities === '0' ? 'no-fatal' : 'unknown');
            const label = isFatal
              ? `${n} ${n === 1 ? 'fatality' : 'fatalities'}`
              : f.fatalities === '0' ? 'No fatalities' : 'Casualties unknown';
            return <span className={`ad-sev ad-sev--${sev}`}>{label}</span>;
          })()}
          {f.location ? <span>{f.location}</span> : null}
          {data.phase_of_flight ? <span>{data.phase_of_flight}</span> : null}
        </p>
      </header>

      {data.probable_cause && (
        <section className="ad-probable">
          <h2>Probable cause</h2>
          <blockquote>{data.probable_cause}</blockquote>
          <p className="ad-attrib">— NTSB Determination</p>
        </section>
      )}

      {data.narrative_text && (
        <section className="ad-narrative">
          <h2>Accident narrative</h2>
          <article>
            {data.narrative_text.split(/\r?\n\r?\n+/).map((p, i) => {
              const txt = p.trim();
              return txt ? <p key={i}>{txt}</p> : null;
            })}
          </article>
        </section>
      )}

      {data.factors && data.factors.length > 0 && (
        <section className="ad-factors">
          <h2>Contributing factors</h2>
          <ul>{data.factors.map((f, i) => {
            // Service emits {label, role: 'cause'|'factor'|null}. Fall back to
            // plain strings if an older client somehow gets the raw shape.
            const label = typeof f === 'string' ? f : f.label;
            const role  = typeof f === 'string' ? null : f.role;
            return (
              <li key={i}>
                {role ? <span className={`ad-role ad-role--${role}`}>{role}</span> : null}
                <span className="ad-factor-label">{label}</span>
              </li>
            );
          })}</ul>
        </section>
      )}

      {(data.phase_of_flight || data.weather_summary) && (
        <section className="ad-conds">
          <h2>Conditions</h2>
          <dl>
            {data.phase_of_flight && <><dt>Phase</dt><dd>{data.phase_of_flight}</dd></>}
            {data.weather_summary && <><dt>Weather</dt><dd>{data.weather_summary}</dd></>}
          </dl>
        </section>
      )}

      {data.related && (data.related.byAircraft?.length || data.related.byOperator?.length) ? (
        <section className="ad-related">
          <h2>Related events</h2>
          {data.related.byAircraft?.length > 0 && (
            <>
              <h3>Same aircraft</h3>
              <ul>{data.related.byAircraft.map(r => (
                <li key={r.id}>
                  {r.date} — {r.aircraft_model} ({r.operator || '—'})
                </li>
              ))}</ul>
            </>
          )}
          {data.related.byOperator?.length > 0 && (
            <>
              <h3>Same operator</h3>
              <ul>{data.related.byOperator.map(r => (
                <li key={r.id}>
                  {r.date} — {r.aircraft_model} ({r.operator || '—'})
                </li>
              ))}</ul>
            </>
          )}
        </section>
      ) : null}

      <footer className="ad-attribution">
        <p>
          Investigation report by {data.source === 'ntsb' ? 'NTSB' : 'Wikidata contributors'}.{' '}
          Original record:{' '}
          <a href={data.source_url} rel="external nofollow">{data.source_url}</a>.{' '}
          This page is a structured re-presentation; facts and quotes are in the{' '}
          {data.source === 'ntsb' ? 'public domain (NTSB)' : 'CC0 (Wikidata)'}.
        </p>
      </footer>
    </main>
  );
}

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
          {f.fatalities && f.fatalities !== '0' ? <span>{f.fatalities} fatalities</span> : null}
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
          <article>{data.narrative_text}</article>
        </section>
      )}

      {data.factors && data.factors.length > 0 && (
        <section className="ad-factors">
          <h2>Contributing factors</h2>
          <ul>{data.factors.map((x, i) => <li key={i}>{x}</li>)}</ul>
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

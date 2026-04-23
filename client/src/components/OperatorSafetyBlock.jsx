import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOperator } from '../pages/safety/safetyApi';
import { useAuth } from '../context/AuthContext';
import './OperatorSafetyBlock.css';

export default function OperatorSafetyBlock({ airlineIata, airlineIcao }) {
  const code = airlineIata || airlineIcao;
  const { getToken } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!code) return;
    let active = true;
    fetchOperator(code, getToken?.() || null)
      .then(r => { if (active) setData(r); })
      .catch(()  => { if (active) setError(true); });
    return () => { active = false; };
  }, [code, getToken]);

  if (error || !data || !code) return null;

  const coverage = data.coverage || 'unknown';
  const counts = data.counts || {};
  const total = counts.total || 0;
  const fatal = counts.fatal || 0;

  // Non-US operators: NTSB doesn't track them. Show an honest "data unavailable"
  // state instead of a false "0 incidents" signal.
  if (coverage !== 'us-ntsb') {
    return (
      <div className="operator-safety operator-safety--unavailable">
        <span className="operator-safety__label">Safety data</span>
        <span className="operator-safety__muted">Unavailable for this operator</span>
        <Link to="/legal/attributions" className="operator-safety__link" rel="nofollow">
          Why?
        </Link>
      </div>
    );
  }

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
      <Link to={`/safety/feed?operator=${encodeURIComponent(code)}`} className="operator-safety__link">
        View full safety history →
      </Link>
    </div>
  );
}

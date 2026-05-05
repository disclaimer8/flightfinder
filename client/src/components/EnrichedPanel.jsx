import { useState } from 'react';
import { useEnrichedCard } from '../hooks/useEnrichedCard';
import { useAuth } from '../context/AuthContext';
import EnrichedTeaser from './EnrichedTeaser';
import { isNativeApp } from '../utils/platform';
import UpgradeModal from './UpgradeModal';
import './EnrichedPanel.css';

export default function EnrichedPanel({ flight, showProTeaser = false }) {
  const { user } = useAuth();
  const isPro = !!user?.subscription_tier?.startsWith('pro_');

  // Free users: show teaser only on the first card (anti-fatigue) and never
  // in the native app (Pricing isn't reachable in the WebView).
  if (!isPro) {
    if (showProTeaser && !isNativeApp()) return <EnrichedTeaser />;
    return null;
  }

  return <EnrichedPanelPro flight={flight} />;
}

function EnrichedPanelPro({ flight }) {
  const { loading, data, tier, error } = useEnrichedCard(flight);
  const [upgrade, setUpgrade] = useState({ open: false, reason: '' });
  const isFree = tier === 'free';

  const askUpgrade = (reason) => setUpgrade({ open: true, reason });

  return (
    <div className="enriched-panel">
      {error && <div className="enriched-error">Could not load extra info.</div>}

      <div className="enriched-grid">
        <Field
          label="Livery"
          value={data?.livery?.imageUrl ? <img src={data.livery.imageUrl} alt="" loading="lazy" className="livery-img" /> : null}
          teaser="✈︎"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('Unlock the livery photo for this exact aircraft type.')}
        />

        <Field
          label="On-time (90d)"
          value={data?.onTime ? `${data.onTime.pct90d}%` : null}
          teaser="##%"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('Unlock on-time stats from the last 90 days.')}
        />

        <Field
          label="CO₂ / pax"
          value={data?.co2 ? `${data.co2.kgPerPax} kg` : null}
          teaser="### kg"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('See carbon footprint per passenger for this exact aircraft.')}
        />

        <Field
          label="Aircraft"
          value={formatAircraft(data?.aircraft)}
          teaser="G-XXXX · 00 yrs"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('See the exact tail and age of the plane flying your route.')}
        />

        <Field
          label="Amenities"
          value={data?.amenities ? <Amenities am={data.amenities} /> : null}
          teaser="🔒🔒🔒🔒"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('Check WiFi / power / entertainment before you book.')}
        />

        <Field
          label="Weather"
          value={data?.weather?.origin && data?.weather?.destination ? (
            <span>{data.weather.origin.tempC}°C → {data.weather.destination.tempC}°C</span>
          ) : null}
          teaser="##°C → ##°C"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('See live weather at origin + destination.')}
        />

        <Field
          label="Gate / Terminal"
          value={data?.gate ? (
            <span>
              {data.gate.originTerminal ? `T${data.gate.originTerminal}` : '—'}
              {data.gate.originGate ? `/${data.gate.originGate}` : ''}
              {' → '}
              {data.gate.destTerminal ? `T${data.gate.destTerminal}` : '—'}
              {data.gate.destGate ? `/${data.gate.destGate}` : ''}
            </span>
          ) : null}
          teaser="T# / A## → T# / B##"
          isFree={isFree} loading={loading}
          onLockedClick={() => askUpgrade('See gate & terminal before heading to the airport.')}
        />
      </div>

      <UpgradeModal open={upgrade.open} reason={upgrade.reason} onClose={() => setUpgrade({ open: false, reason: '' })} />
    </div>
  );
}

function Field({ label, value, teaser, isFree, loading, onLockedClick }) {
  const locked = isFree && (value == null || value === '');
  return (
    <div className={`enriched-field ${locked ? 'locked' : ''}`}>
      <div className="enriched-label">{label}</div>
      {loading ? (
        <div className="enriched-skel" />
      ) : locked ? (
        <button type="button" className="enriched-teaser" onClick={onLockedClick}>
          <span className="blur">{teaser}</span>
          <span className="lock-badge" aria-label="Pro only">🔒 Pro</span>
        </button>
      ) : (
        <div className="enriched-value">{value ?? '—'}</div>
      )}
    </div>
  );
}

// Renders whatever Aircraft details the API returned, in priority order.
// Full coverage: "G-XWBA · 5 yrs · A359". Tail-only: "G-XWBA · A359".
// Type-only (most common — airlabs has no record for this flight):
// "Airbus A350-900" via the icaoType. Empty: null → UI shows "—".
const ICAO_DISPLAY = {
  A319: 'Airbus A319', A320: 'Airbus A320', A20N: 'Airbus A320neo',
  A321: 'Airbus A321', A21N: 'Airbus A321neo', A332: 'Airbus A330-200',
  A333: 'Airbus A330-300', A339: 'Airbus A330-900neo', A343: 'Airbus A340-300',
  A346: 'Airbus A340-600', A359: 'Airbus A350-900', A35K: 'Airbus A350-1000',
  A388: 'Airbus A380', BCS3: 'Airbus A220-300',
  B712: 'Boeing 717', B737: 'Boeing 737-700', B738: 'Boeing 737-800',
  B739: 'Boeing 737-900', B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', B752: 'Boeing 757-200',
  B763: 'Boeing 767-300', B772: 'Boeing 777-200', B77W: 'Boeing 777-300ER',
  B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10',
  E170: 'Embraer E170', E190: 'Embraer E190', E195: 'Embraer E195',
  E75L: 'Embraer E175', CRJ7: 'CRJ-700', CRJ9: 'CRJ-900',
  AT72: 'ATR 72', AT76: 'ATR 72-600', DH8D: 'Dash 8 Q400',
};
function formatAircraft(ac) {
  if (!ac) return null;
  const typeLabel = ac.icaoType ? (ICAO_DISPLAY[ac.icaoType] || ac.icaoType) : null;
  const parts = [];
  if (ac.registration) parts.push(ac.registration);
  if (ac.ageYears) parts.push(`${ac.ageYears} yrs`);
  if (typeLabel) parts.push(typeLabel);
  return parts.length ? parts.join(' · ') : null;
}

function Amenities({ am }) {
  return (
    <span className="amenities">
      <span title="WiFi"          className={am.wifi ? 'yes' : 'no'}>📶</span>
      <span title="Power"         className={am.power ? 'yes' : 'no'}>🔌</span>
      <span title="Entertainment" className={am.entertainment ? 'yes' : 'no'}>🎬</span>
      <span title="Meal"          className={am.meal ? 'yes' : 'no'}>🍽</span>
    </span>
  );
}

import { useState } from 'react';
import { useEnrichedCard } from '../hooks/useEnrichedCard';
import UpgradeModal from './UpgradeModal';
import './EnrichedPanel.css';

export default function EnrichedPanel({ flight }) {
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
          value={data?.aircraft ? `${data.aircraft.registration || ''} · ${data.aircraft.ageYears ? `${data.aircraft.ageYears} yrs` : ''}` : null}
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

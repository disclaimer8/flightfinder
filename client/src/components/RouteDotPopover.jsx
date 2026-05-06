import { useEffect } from 'react';
import Button from './Button';
import './RouteDotPopover.css';

export default function RouteDotPopover({ dep, arr, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const depLow = String(dep).toLowerCase();
  const arrLow = String(arr).toLowerCase();

  return (
    <div className="route-dot-popover" role="dialog" aria-modal="true" aria-label={`Route ${dep} to ${arr}`} onClick={onClose}>
      <div className="route-dot-popover__panel" onClick={e => e.stopPropagation()}>
        <button className="route-dot-popover__close" type="button" onClick={onClose} aria-label="Close">×</button>
        <div className="route-dot-popover__head">
          <span className="route-dot-popover__eyebrow">ROUTE</span>
          <h3 className="route-dot-popover__title">
            <span className="route-dot-popover__iata">{dep}</span>
            <span className="route-dot-popover__arrow"> → </span>
            <span className="route-dot-popover__iata">{arr}</span>
          </h3>
        </div>
        <div className="route-dot-popover__actions">
          <Button to={`/routes/${depLow}-${arrLow}`} variant="primary">View route page →</Button>
          <Button to={`/?mode=search&from=${dep}&to=${arr}`} variant="secondary">Search flights →</Button>
        </div>
      </div>
    </div>
  );
}

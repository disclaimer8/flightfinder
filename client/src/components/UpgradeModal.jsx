import './UpgradeModal.css';

export default function UpgradeModal({ open, reason, onClose }) {
  if (!open) return null;
  return (
    <div
      className="upgrade-modal-backdrop"
      data-testid="upgrade-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="upgrade-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="upgrade-modal-title">Go Pro</h2>
        <p className="upgrade-modal-reason">{reason}</p>
        <ul className="upgrade-modal-bullets">
          <li>Real on-time % per flight (90 days)</li>
          <li>CO₂ / passenger + amenities + livery photo</li>
          <li>My Trips live status + delay alerts</li>
        </ul>
        <div className="upgrade-modal-actions">
          <a href="/pricing" className="btn btn-primary" role="link">See plans</a>
          <button onClick={onClose} className="btn btn-ghost">Not now</button>
        </div>
      </div>
    </div>
  );
}

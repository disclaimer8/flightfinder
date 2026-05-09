import './SafetyBadge.css';

/**
 * Color-coded safety pill that summarises an operator's risk level for
 * a flight card. Consumes the output of utils/safetyRiskLevel.getRiskLevel.
 *
 * Renders nothing when level === 'none' (no data) so the card stays clean.
 */
export default function SafetyBadge({ risk }) {
  if (!risk || risk.level === 'none') return null;

  const dotByLevel = { green: '●', yellow: '●', red: '●' };
  const dot = dotByLevel[risk.level] || '●';

  return (
    <div
      className={`safety-badge safety-badge--${risk.level}`}
      role="status"
      aria-label={`Safety: ${risk.label}${risk.summary ? '. ' + risk.summary : ''}`}
    >
      <span className="safety-badge__dot" aria-hidden="true">{dot}</span>
      <span className="safety-badge__label">{risk.label}</span>
      {risk.summary && (
        <span className="safety-badge__summary">{risk.summary}</span>
      )}
    </div>
  );
}

import './SkeletonResults.css';

function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton-header">
        <div className="skeleton-line sk-w-40" />
        <div className="skeleton-line sk-w-20" />
      </div>
      <div className="skeleton-route">
        <div className="skeleton-circle" />
        <div className="skeleton-line sk-w-full" />
        <div className="skeleton-circle" />
      </div>
      <div className="skeleton-footer">
        <div className="skeleton-line sk-w-30" />
        <div className="skeleton-pill" />
      </div>
    </div>
  );
}

function SkeletonResults({ message }) {
  return (
    <div
      className="skeleton-results"
      role="status"
      aria-live="polite"
      aria-label={message || 'Loading…'}
    >
      <p className="skeleton-message">{message || 'Loading…'}</p>
      <div className="skeleton-list">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

export default SkeletonResults;

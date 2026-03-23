import './APIStatus.css';

function APIStatus({ status }) {
  if (!status?.duffel) return null;
  return (
    <div className="api-status">
      <div className="status-badges">
        <span className="badge active">✓ Live flights</span>
      </div>
    </div>
  );
}

export default APIStatus;

import './APIStatus.css';

function APIStatus({ status }) {
  return (
    <div className="api-status">
      <div className="status-badges">
        <span className={`badge ${status.duffel ? 'active' : 'inactive'}`}>
          {status.duffel ? '✓' : '○'} Duffel API
        </span>
        <span className={`badge ${status.airlabs ? 'active' : 'inactive'}`}>
          {status.airlabs ? '✓' : '○'} AirLabs API
        </span>
      </div>
    </div>
  );
}

export default APIStatus;

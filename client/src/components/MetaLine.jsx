import './MetaLine.css';

export default function MetaLine({ effective, lastUpdated }) {
  return (
    <p className="meta-line">
      {effective && (
        <>
          <span className="meta-line__label">Effective</span>
          <span className="meta-line__value">{effective}</span>
        </>
      )}
      {effective && lastUpdated && <span className="meta-line__sep"> · </span>}
      {lastUpdated && (
        <>
          <span className="meta-line__label">Last updated</span>
          <span className="meta-line__value">{lastUpdated}</span>
        </>
      )}
    </p>
  );
}

import { Link } from 'react-router-dom';
import './EmptyState.css';

export default function EmptyState({
  variant = 'inline',
  heading,
  children,
  cta,
}) {
  const className = `empty-state empty-state--${variant}`;
  return (
    <div className={className}>
      {heading && <h2 className="empty-state__heading">{heading}</h2>}
      {typeof children === 'string' ? (
        <p className="empty-state__body">{children}</p>
      ) : children}
      {cta && (
        cta.to ? (
          <Link to={cta.to} className="btn btn--primary btn--sm">{cta.label}</Link>
        ) : (
          <a href={cta.href} className="btn btn--primary btn--sm">{cta.label}</a>
        )
      )}
    </div>
  );
}

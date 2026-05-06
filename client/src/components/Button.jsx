import { Link } from 'react-router-dom';
import './Button.css';

export default function Button({
  to,
  href,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}) {
  const cls = ['btn', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ');
  if (to) return <Link to={to} className={cls} {...rest}>{children}</Link>;
  if (href) return <a href={href} className={cls} {...rest}>{children}</a>;
  return <button className={cls} {...rest}>{children}</button>;
}

// SiteHeader: navy bar with logo, brand, and nav. Mirrors FLIGHT/SiteHeader.
function SiteHeader({ activeNav, onNav }) {
  const navItems = [
    { id: 'safety', label: 'Safety', kind: 'link' },
    { id: 'pricing', label: 'Pricing', kind: 'link' },
    { id: 'signin', label: 'Sign in', kind: 'pill' },
    { id: 'signup', label: 'Sign up', kind: 'signup' },
  ];
  return (
    <header className="hdr">
      <a className="hdr__brand" onClick={() => onNav('home')} href="#">
        Flight<span style={{ fontWeight: 400, opacity: 0.7 }}>&nbsp;Finder</span>
      </a>
      <nav className="hdr__nav">
        <span className="hdr__pill is-live">✓ Live flights</span>
        {navItems.map(n => (
          <a key={n.id} href="#" onClick={(e) => { e.preventDefault(); onNav(n.id); }}
            className={
              'hdr__pill ' +
              (n.kind === 'link' ? 'is-link ' : '') +
              (n.kind === 'signup' ? 'is-signup ' : '') +
              (activeNav === n.id ? 'is-active' : '')
            }>
            {n.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
window.SiteHeader = SiteHeader;

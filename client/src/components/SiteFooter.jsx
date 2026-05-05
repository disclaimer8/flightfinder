import './SiteFooter.css';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-col">
          <div className="site-footer-heading">Explore</div>
          <a href="/">Search flights</a>
          <a href="/by-aircraft">Browse aircraft</a>
          <a href="/safety/global">Aviation safety database</a>
          <a href="/safety/feed">NTSB safety feed</a>
        </div>
        <div className="site-footer-col">
          <div className="site-footer-heading">Account</div>
          <a href="/pricing">Pricing</a>
          <a href="/trips">My Trips</a>
        </div>
        <div className="site-footer-col">
          <div className="site-footer-heading">Legal</div>
          <a href="/legal/terms">Terms</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/attributions">Attributions</a>
        </div>
      </div>
      <div className="site-footer-bottom">
        © {new Date().getFullYear()} FlightFinder
      </div>
    </footer>
  );
}

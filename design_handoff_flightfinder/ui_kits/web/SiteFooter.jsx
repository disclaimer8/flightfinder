function SiteFooter() {
  return (
    <>
      <footer className="ftr">
        <div className="ftr__col">
          <div className="ftr__head">Explore</div>
          <a className="ftr__lnk" href="#">Search flights</a>
          <a className="ftr__lnk" href="#">Aviation safety database</a>
          <a className="ftr__lnk" href="#">NTSB safety feed</a>
        </div>
        <div className="ftr__col">
          <div className="ftr__head">Account</div>
          <a className="ftr__lnk" href="#">Pricing</a>
          <a className="ftr__lnk" href="#">My Trips</a>
        </div>
        <div className="ftr__col">
          <div className="ftr__head">Legal</div>
          <a className="ftr__lnk" href="#">Terms</a>
          <a className="ftr__lnk" href="#">Privacy</a>
          <a className="ftr__lnk" href="#">Attributions</a>
        </div>
      </footer>
      <div className="ftr__copy">© 2026 FlightFinder</div>
    </>
  );
}
window.SiteFooter = SiteFooter;

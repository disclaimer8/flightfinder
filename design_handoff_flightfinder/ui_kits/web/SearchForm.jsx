// SearchForm — home page hero search card.
function SearchForm({ from, to, date, pax, onChange, onSubmit }) {
  return (
    <div className="search">
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className="tabs__tab is-active">🔍 Search Route</button>
        <button className="tabs__tab">🌍 Explore Destinations</button>
      </div>
      <div className="search__row">
        <div className="search__field">
          <div className="search__lbl">From</div>
          <div className={'search__input ' + (from ? '' : 'is-placeholder')}
               onClick={() => onChange({ from: 'London Heathrow (LHR)' })}>
            <span>{from || 'Select departure city'}</span>
            <span style={{ color: 'var(--text-3)' }}>▾</span>
          </div>
        </div>
        <button className="search__swap" onClick={() => onChange({ swap: true })} title="Swap">
          ⇄
        </button>
        <div className="search__field">
          <div className="search__lbl">To</div>
          <div className={'search__input ' + (to ? '' : 'is-placeholder')}
               onClick={() => onChange({ to: 'New York JFK (JFK)' })}>
            <span>{to || 'Select arrival city'}</span>
            <span style={{ color: 'var(--text-3)' }}>▾</span>
          </div>
        </div>
      </div>
      <div className="search__grid2">
        <div className="search__field">
          <div className="search__lbl">Departure date</div>
          <div className="search__input">
            <span>📅 {date}</span>
            <span style={{ color: 'var(--text-3)' }}>▾</span>
          </div>
        </div>
        <div className="search__field">
          <div className="search__lbl">Passengers</div>
          <div className="search__input" style={{ justifyContent: 'space-between' }}>
            <button onClick={() => onChange({ pax: Math.max(1, pax - 1) })}
                    style={{ border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer' }}>−</button>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{pax}</span>
            <button onClick={() => onChange({ pax: pax + 1 })}
                    style={{ border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer' }}>+</button>
          </div>
        </div>
      </div>
      <div className="search__grid2">
        <div className="search__field">
          <div className="search__lbl">Aircraft type</div>
          <div className="search__input"><span>All types</span><span style={{color:'var(--text-3)'}}>▾</span></div>
        </div>
        <div className="search__field">
          <div className="search__lbl">Aircraft model</div>
          <div className="search__input is-placeholder">
            <span>All models</span><span style={{color:'var(--text-3)'}}>▾</span>
          </div>
        </div>
      </div>
      <button className="btn btn--primary btn--block search__cta" onClick={onSubmit}>
        Search Flights
      </button>
    </div>
  );
}
window.SearchForm = SearchForm;

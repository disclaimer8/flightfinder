// Page-level building blocks
function PageContainer({ children }) {
  return <div className="container">{children}</div>;
}
window.PageContainer = PageContainer;

function Breadcrumb({ items }) {
  return (
    <div className="crumb">
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="sep">›</span>}
          {it.href
            ? <a onClick={(e) => { e.preventDefault(); it.onClick && it.onClick(); }}>{it.label}</a>
            : <span>{it.label}</span>}
        </React.Fragment>
      ))}
    </div>
  );
}
window.Breadcrumb = Breadcrumb;

function CategoryPill({ children }) {
  return <div className="cat-pill">{children}</div>;
}
window.CategoryPill = CategoryPill;

function TitleBlock({ title, subtitle, cta }) {
  return (
    <div className="title-block">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {cta}
    </div>
  );
}
window.TitleBlock = TitleBlock;

function FAQ({ items }) {
  const [open, setOpen] = React.useState(0);
  return (
    <div className="faq">
      {items.map((it, i) => (
        <div key={i} className="faq__item" onClick={() => setOpen(open === i ? -1 : i)}>
          <div className="faq__q">
            {it.q}
            <span className="faq__caret">{open === i ? '−' : '+'}</span>
          </div>
          {open === i && <div className="faq__a">{it.a}</div>}
        </div>
      ))}
    </div>
  );
}
window.FAQ = FAQ;

function SafetyEvent({ date, op, location, link }) {
  return (
    <div className="evt">
      <div className="evt__date">{date}</div>
      <div>
        <div className="evt__op">{op}</div>
        <div className="evt__loc">{location}</div>
        {link && <a className="evt__lnk" href="#">{link} →</a>}
      </div>
    </div>
  );
}
window.SafetyEvent = SafetyEvent;

function RouteTileGrid({ tiles, onClick }) {
  return (
    <div className="tiles">
      {tiles.map(t => (
        <a key={t} className="tile" href="#" onClick={(e) => { e.preventDefault(); onClick && onClick(t); }}>{t}</a>
      ))}
    </div>
  );
}
window.RouteTileGrid = RouteTileGrid;

function Callout({ children }) {
  return <div className="callout">{children}</div>;
}
window.Callout = Callout;

function PricingGrid({ tiers, onSubscribe }) {
  return (
    <div className="pricing">
      {tiers.map(t => (
        <div key={t.tier} className={'pricing__card ' + (t.highlight ? 'is-highlight' : '')}>
          {t.highlight && <span className="pricing__ribbon">Recommended</span>}
          <div className="eyebrow eyebrow--strong">{t.eyebrow}</div>
          <div className="pricing__price-row">
            <span className="pricing__price">{t.price}</span>
            {t.cadence && <span className="pricing__cadence">{t.cadence}</span>}
          </div>
          <ul className="pricing__features">{t.features.map(f => <li key={f}>{f}</li>)}</ul>
          <button className="btn btn--primary" onClick={() => onSubscribe(t.tier)}>
            {t.cta || 'Subscribe'}
          </button>
        </div>
      ))}
    </div>
  );
}
window.PricingGrid = PricingGrid;

function StatCard({ title, rows }) {
  return (
    <div className="stat-card">
      <h3>{title}</h3>
      {rows.map((r, i) => (
        <div key={i} className="stat-row">
          <div className="stat-row__rank">{i + 1}</div>
          <div className="stat-row__name">{r.name}</div>
          <div className="stat-row__count">{r.count} events</div>
          <div className={'stat-row__fatal ' + (r.fatal > 0 ? 'is-bad' : '')}>{r.fatal} fatal.</div>
        </div>
      ))}
    </div>
  );
}
window.StatCard = StatCard;

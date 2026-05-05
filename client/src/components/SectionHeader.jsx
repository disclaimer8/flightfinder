import './SectionHeader.css';

export default function SectionHeader({ number, label, accessory = null }) {
  return (
    <header className="section-header">
      <div className="section-header__eyebrow">
        <span className="section-header__number">{number}</span>
        <span className="section-header__sep"> / </span>
        <span className="section-header__label">{label}</span>
      </div>
      {accessory && <div className="section-header__accessory">{accessory}</div>}
    </header>
  );
}

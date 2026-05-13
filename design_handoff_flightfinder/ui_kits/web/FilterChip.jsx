// FilterChipRow — used on the search results bar
function FilterChipRow({ filters, onClear }) {
  return (
    <>
      {filters.map(f => (
        <button key={f.label}
                className={'chip ' + (f.value ? 'is-filled' : '')}>
          {f.value ? `${f.label}: ${f.value}` : `+ ${f.label}`}
          {f.value && (
            <span className="chip__x"
                  onClick={(e) => { e.stopPropagation(); onClear(f.label); }}>✕</span>
          )}
        </button>
      ))}
    </>
  );
}
window.FilterChipRow = FilterChipRow;

function SortMenu({ value, onChange }) {
  const options = ['Best', 'Price', 'Duration', 'Depart'];
  return (
    <button className="sort">
      Sort: <span style={{ color: 'var(--text)', marginLeft: 4 }}>{value}</span>
      <span style={{ color: 'var(--text-3)' }}>▾</span>
    </button>
  );
}
window.SortMenu = SortMenu;

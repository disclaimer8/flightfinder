import { useSearchParams } from 'react-router-dom';
import { parseSearchParams, serializeSearchParams } from '../utils/searchParams';
import './SortMenu.css';

const SORT_OPTIONS = [
  { value: 'cheapest',         label: 'Cheapest first' },
  { value: 'fastest',          label: 'Fastest first' },
  { value: 'safety',           label: 'Best safety first ⭐' },
  { value: 'departure-asc',    label: 'Departure: earliest' },
  { value: 'departure-desc',   label: 'Departure: latest' },
];

export default function SortMenu() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = parseSearchParams(searchParams);

  const onChange = (e) => {
    const next = { ...state, sort: e.target.value };
    setSearchParams(serializeSearchParams(next), { replace: true });
  };

  return (
    <label className="sort-menu">
      <span className="sort-menu-label">Sort by</span>
      <select aria-label="Sort by" value={state.sort} onChange={onChange}>
        {SORT_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

import { useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import FilterChip from './FilterChip';
import { FilterOptionsContext } from '../context/FilterOptionsContext';
import { parseSearchParams, serializeSearchParams, DEFAULTS } from '../utils/searchParams';

function summarize(codes, airlinesByCode) {
  if (!codes.length) return null;
  const firstName = airlinesByCode[codes[0]]?.name || codes[0];
  if (codes.length === 1) return firstName;
  return `${firstName} +${codes.length - 1}`;
}

export default function AirlinesChip() {
  const filterOptions = useContext(FilterOptionsContext);
  const airlines = filterOptions?.airlines || [];
  const airlinesByCode = Object.fromEntries(airlines.map(a => [a.code, a]));

  const [searchParams, setSearchParams] = useSearchParams();
  const state = parseSearchParams(searchParams);
  const selected = new Set(state.airlines);

  const update = (nextCodes) => {
    const next = { ...state, airlines: nextCodes };
    setSearchParams(serializeSearchParams(next), { replace: true });
  };

  const toggle = (code) => {
    const out = new Set(selected);
    if (out.has(code)) out.delete(code); else out.add(code);
    update([...out]);
  };

  const clear = () => update(DEFAULTS.airlines);

  return (
    <FilterChip
      label="Airlines"
      summary={summarize(state.airlines, airlinesByCode)}
      hasValue={state.airlines.length > 0}
      onClear={clear}
    >
      <div className="filter-chip-checkbox-list">
        {airlines.map(a => (
          <label key={a.code} className="filter-chip-checkbox">
            <input
              type="checkbox"
              checked={selected.has(a.code)}
              onChange={() => toggle(a.code)}
            />
            <span>{a.name} <span className="filter-chip-airline-iata">({a.code})</span></span>
          </label>
        ))}
      </div>
    </FilterChip>
  );
}

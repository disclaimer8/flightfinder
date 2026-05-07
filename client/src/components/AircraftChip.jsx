import { useSearchParams } from 'react-router-dom';
import FilterChip from './FilterChip';
import { AIRCRAFT_FAMILIES, getFamily } from '../utils/aircraftFamilies';
import { parseSearchParams, serializeSearchParams, DEFAULTS } from '../utils/searchParams';

function summarize(slugs) {
  if (!slugs.length) return null;
  if (slugs.length === 1) return getFamily(slugs[0])?.label || slugs[0];
  return `${getFamily(slugs[0])?.label || slugs[0]} +${slugs.length - 1}`;
}

export default function AircraftChip() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = parseSearchParams(searchParams);
  const selected = new Set(state.aircraft);

  const update = (nextSlugs) => {
    // Search-affecting? No — aircraft is a filter. Don't reset shown.
    const next = { ...state, aircraft: nextSlugs };
    setSearchParams(serializeSearchParams(next), { replace: true });
  };

  const toggle = (slug) => {
    const out = new Set(selected);
    if (out.has(slug)) out.delete(slug); else out.add(slug);
    update([...out]);
  };

  const clear = () => update(DEFAULTS.aircraft);

  return (
    <FilterChip
      label="Aircraft"
      summary={summarize(state.aircraft)}
      hasValue={state.aircraft.length > 0}
      onClear={clear}
    >
      <div className="filter-chip-checkbox-list">
        {AIRCRAFT_FAMILIES.map(fam => (
          <label key={fam.slug} className="filter-chip-checkbox">
            <input
              type="checkbox"
              checked={selected.has(fam.slug)}
              onChange={() => toggle(fam.slug)}
            />
            <span>{fam.label}</span>
          </label>
        ))}
      </div>
    </FilterChip>
  );
}

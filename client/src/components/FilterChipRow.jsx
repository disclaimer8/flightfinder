import AircraftChip from './AircraftChip';
import AirlinesChip from './AirlinesChip';
import SortMenu from './SortMenu';
import './FilterChipRow.css';

export default function FilterChipRow() {
  return (
    <div className="filter-chip-row" role="region" aria-label="Filter and sort flights">
      <div className="filter-chip-row-chips">
        <AircraftChip />
        <AirlinesChip />
      </div>
      <div className="filter-chip-row-sort">
        <SortMenu />
      </div>
    </div>
  );
}

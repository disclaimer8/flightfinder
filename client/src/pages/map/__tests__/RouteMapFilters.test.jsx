import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import RouteMapFilters from '../RouteMapFilters';

const AIRLINES = [
  { iata: 'BA',  name: 'British Airways', count: 120 },
  { iata: 'LH',  name: 'Lufthansa',       count: 95  },
  { iata: 'FR',  name: 'Ryanair',          count: 210 },
];

const AIRCRAFT_LIST = [
  { icao: 'B738', label: 'Boeing 737-800',   count: 300 },
  { icao: 'A320', label: 'Airbus A320',       count: 280 },
  { icao: 'A359', label: 'Airbus A350-900',   count: 90  },
];

function renderFilters(overrides = {}) {
  const defaults = {
    airline:      null,
    aircraft:     null,
    airlines:     AIRLINES,
    aircraftList: AIRCRAFT_LIST,
    onChange:     vi.fn(),
  };
  return render(<RouteMapFilters {...defaults} {...overrides} />);
}

describe('RouteMapFilters', () => {
  // ── Test 1: placeholder text when nothing is selected ──────────────────────
  it('renders with placeholder text when no airline/aircraft selected', () => {
    renderFilters();

    expect(
      screen.getByPlaceholderText('Filter by airline')
    ).toBeInTheDocument();

    expect(
      screen.getByPlaceholderText('Filter by aircraft type')
    ).toBeInTheDocument();

    // No clear buttons when nothing is selected
    expect(screen.queryByLabelText('Clear airline filter')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Clear aircraft filter')).not.toBeInTheDocument();
  });

  // ── Test 2: selecting a suggestion fires onChange with the IATA code ───────
  it('selecting "British Airways" from suggestions fires onChange with airline=BA', () => {
    const onChange = vi.fn();
    renderFilters({ onChange });

    const airlineInput = screen.getByLabelText('Filter by airline');

    // Simulate typing a partial match then selecting the full suggestion value
    fireEvent.change(airlineInput, { target: { value: 'Brit' } });
    // Not an exact match yet — onChange should NOT have been called
    expect(onChange).not.toHaveBeenCalled();

    // Simulate selecting the suggestion (browser sets input to option value = name)
    fireEvent.change(airlineInput, { target: { value: 'British Airways' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ airline: 'BA', aircraft: null });
  });

  // ── Test 3: clear button fires onChange with airline=null ─────────────────
  it('clicking the clear-X next to a selected airline fires onChange with airline=null', () => {
    const onChange = vi.fn();
    // Render with airline pre-selected
    renderFilters({ airline: 'BA', aircraft: null, onChange });

    const clearBtn = screen.getByLabelText('Clear airline filter');
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ airline: null, aircraft: null });
  });

  // ── Test 4: updates displayed text when `airline` prop changes externally ──
  it('updates displayed text when `airline` prop changes externally', () => {
    const onChange = vi.fn();
    const { rerender } = renderFilters({ airline: null, onChange });

    // Initially no airline selected — input should be blank
    const airlineInput = screen.getByLabelText('Filter by airline');
    expect(airlineInput.value).toBe('');

    // Parent re-renders with a new airline prop (e.g. URL navigation)
    act(() => {
      rerender(
        <RouteMapFilters
          airline="BA"
          aircraft={null}
          airlines={AIRLINES}
          aircraftList={AIRCRAFT_LIST}
          onChange={onChange}
        />
      );
    });

    expect(airlineInput.value).toBe('British Airways');
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import CityAutocomplete from '../CityAutocomplete';
import { FilterOptionsContext } from '../../context/FilterOptionsContext';

const filterOptions = {
  cities: [
    { code: 'LHR', name: 'London (Heathrow)' },
    { code: 'LGW', name: 'London (Gatwick)' },
    { code: 'STN', name: 'London (Stansted)' },
    { code: 'JFK', name: 'New York (JFK)' },
    { code: 'CDG', name: 'Paris (CDG)' },
  ],
  cityGroups: [
    {
      region: 'Europe — West',
      cities: [
        { code: 'LHR', name: 'London (Heathrow)' },
        { code: 'LGW', name: 'London (Gatwick)' },
        { code: 'STN', name: 'London (Stansted)' },
        { code: 'CDG', name: 'Paris (CDG)' },
      ],
    },
    {
      region: 'North America',
      cities: [
        { code: 'JFK', name: 'New York (JFK)' },
      ],
    },
  ],
};

function renderWithContext(props, ctx = filterOptions) {
  return render(
    <FilterOptionsContext.Provider value={ctx}>
      <CityAutocomplete {...props} />
    </FilterOptionsContext.Provider>
  );
}

describe('CityAutocomplete', () => {
  test('empty value renders empty input with placeholder', () => {
    renderWithContext({ value: '', onChange: vi.fn(), ariaLabel: 'From', placeholder: 'City or airport' });
    const input = screen.getByRole('combobox', { name: /from/i });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'City or airport');
  });

  test('value=LHR renders the friendly label in the input', () => {
    renderWithContext({ value: 'LHR', onChange: vi.fn(), ariaLabel: 'From' });
    const input = screen.getByRole('combobox', { name: /from/i });
    expect(input.value).toMatch(/London.*Heathrow/i);
  });

  test('click opens dropdown showing all options', () => {
    renderWithContext({ value: '', onChange: vi.fn(), ariaLabel: 'From' });
    const input = screen.getByRole('combobox', { name: /from/i });
    fireEvent.click(input);
    // All 5 options should appear
    expect(screen.getAllByRole('option').length).toBe(5);
  });

  test('type "lond" filters to 3 London options', () => {
    renderWithContext({ value: '', onChange: vi.fn(), ariaLabel: 'From' });
    const input = screen.getByRole('combobox', { name: /from/i });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'lond' } });
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(3);
    expect(options.every(o => o.textContent.toLowerCase().includes('london'))).toBe(true);
  });

  test('type "jfk" filters to JFK option', () => {
    renderWithContext({ value: '', onChange: vi.fn(), ariaLabel: 'From' });
    const input = screen.getByRole('combobox', { name: /from/i });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'jfk' } });
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(1);
    expect(options[0].textContent).toMatch(/JFK/);
  });

  test('click option calls onChange with IATA code and closes dropdown', () => {
    const onChange = vi.fn();
    renderWithContext({ value: '', onChange, ariaLabel: 'From' });
    const input = screen.getByRole('combobox', { name: /from/i });
    fireEvent.click(input);
    const lhrOption = screen.getByRole('option', { name: /Heathrow/i });
    fireEvent.click(lhrOption);
    expect(onChange).toHaveBeenCalledWith('LHR');
    expect(screen.queryByRole('option')).toBeNull();
  });

  test('ESC closes dropdown', () => {
    renderWithContext({ value: '', onChange: vi.fn(), ariaLabel: 'From' });
    const input = screen.getByRole('combobox', { name: /from/i });
    fireEvent.click(input);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('option')).toBeNull();
  });

  test('click outside closes dropdown', () => {
    renderWithContext({ value: '', onChange: vi.fn(), ariaLabel: 'From' });
    const input = screen.getByRole('combobox', { name: /from/i });
    fireEvent.click(input);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('option')).toBeNull();
  });

  test('arrow down opens dropdown, moves highlight, Enter selects', () => {
    const onChange = vi.fn();
    renderWithContext({ value: '', onChange, ariaLabel: 'From' });
    const input = screen.getByRole('combobox', { name: /from/i });
    // Arrow down opens it
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    // First option should be highlighted (aria-selected)
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    // Arrow down again moves to second
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    // Enter selects
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalled();
    expect(screen.queryByRole('option')).toBeNull();
  });

  test('direct IATA typing + blur commits value', () => {
    const onChange = vi.fn();
    renderWithContext({ value: '', onChange, ariaLabel: 'To' });
    const input = screen.getByRole('combobox', { name: /to/i });
    fireEvent.change(input, { target: { value: 'JFK' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('JFK');
  });

  test('no filterOptions context → plain input still renders without crashing', () => {
    render(
      <FilterOptionsContext.Provider value={null}>
        <CityAutocomplete value="" onChange={vi.fn()} ariaLabel="From" placeholder="City or airport" />
      </FilterOptionsContext.Provider>
    );
    const input = screen.getByRole('combobox', { name: /from/i });
    expect(input).toBeInTheDocument();
    // clicking should not open a dropdown (no data)
    fireEvent.click(input);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('Tab closes dropdown without selecting', () => {
    const onChange = vi.fn();
    renderWithContext({ value: '', onChange, ariaLabel: 'From' });
    const input = screen.getByRole('combobox', { name: /from/i });
    fireEvent.click(input);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.queryByRole('option')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('falls back to cityGroups when cities is absent', () => {
    const ctxNoCities = {
      cityGroups: filterOptions.cityGroups,
    };
    render(
      <FilterOptionsContext.Provider value={ctxNoCities}>
        <CityAutocomplete value="" onChange={vi.fn()} ariaLabel="From" />
      </FilterOptionsContext.Provider>
    );
    const input = screen.getByRole('combobox', { name: /from/i });
    fireEvent.click(input);
    // Should show all cities derived from cityGroups
    expect(screen.getAllByRole('option').length).toBe(5);
  });
});

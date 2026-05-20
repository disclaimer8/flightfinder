import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapFilters from '../MapFilters';

const OPTS = {
  airlines: [
    { iata: 'BAW', name: 'British Airways', count: 120 },
    { iata: 'DLH', name: 'Lufthansa',       count: 95  },
    { iata: 'AFR', name: 'Air France',      count: 80  },
  ],
  aircraft: [
    { icao: 'A380', label: 'Airbus A380',  count: 30 },
    { icao: 'B738', label: 'Boeing 737-800', count: 250 },
  ],
};

describe('MapFilters', () => {
  it('shows "Add filter" button when no filters active', () => {
    render(<MapFilters airline={null} aircraft={null} options={OPTS} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /add filter/i })).toBeInTheDocument();
    expect(screen.queryByText(/airline:/i)).not.toBeInTheDocument();
  });

  it('renders chips for active airline and aircraft filters', () => {
    render(<MapFilters airline="BAW" aircraft="A380" options={OPTS} onChange={() => {}} />);
    expect(screen.getByText(/British Airways/i)).toBeInTheDocument();
    expect(screen.getByText(/Airbus A380/i)).toBeInTheDocument();
  });

  it('falls back to code when option metadata is missing', () => {
    render(<MapFilters airline="XYZ" aircraft={null} options={OPTS} onChange={() => {}} />);
    expect(screen.getByText(/XYZ/)).toBeInTheDocument();
  });

  it('calls onChange with cleared airline when × clicked on airline chip', () => {
    const onChange = vi.fn();
    render(<MapFilters airline="BAW" aircraft="A380" options={OPTS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove airline filter/i }));
    expect(onChange).toHaveBeenCalledWith({ airline: null, aircraft: 'A380' });
  });

  it('calls onChange with cleared aircraft when × clicked on aircraft chip', () => {
    const onChange = vi.fn();
    render(<MapFilters airline="BAW" aircraft="A380" options={OPTS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove aircraft filter/i }));
    expect(onChange).toHaveBeenCalledWith({ airline: 'BAW', aircraft: null });
  });

  it('opens combobox on "Add filter" click and selecting an airline calls onChange', () => {
    const onChange = vi.fn();
    render(<MapFilters airline={null} aircraft={null} options={OPTS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    // Combobox has Airline tab open by default
    fireEvent.click(screen.getByText('British Airways'));
    expect(onChange).toHaveBeenCalledWith({ airline: 'BAW', aircraft: null });
  });

  it('switches to aircraft tab and selects an aircraft', () => {
    const onChange = vi.fn();
    render(<MapFilters airline={null} aircraft={null} options={OPTS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    fireEvent.click(screen.getByRole('tab', { name: /aircraft/i }));
    fireEvent.click(screen.getByText('Airbus A380'));
    expect(onChange).toHaveBeenCalledWith({ airline: null, aircraft: 'A380' });
  });
});

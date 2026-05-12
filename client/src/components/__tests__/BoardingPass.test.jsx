import { render, screen } from '@testing-library/react';
import BoardingPass from '../BoardingPass';

const samplePass = {
  cabin: 'BUSINESS',
  passenger: 'KOLOMIIETS / DENYS',
  flight: 'BA 287',
  date: 'Wed 15 May',
  gate: 'A23',
  boarding: '08:55',
  seat: '12K',
  group: 'B',
  pnr: 'X7K2HQ',
  duration: '11h 25m',
  from: { iata: 'LHR', city: 'London',   time: '09:25' },
  to:   { iata: 'JFK', city: 'New York', time: '12:50' },
};

describe('BoardingPass', () => {
  it('renders both IATA codes and city names', () => {
    render(<BoardingPass pass={samplePass} />);
    // IATA appears twice each (main + stub)
    expect(screen.getAllByText('LHR').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('JFK').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText('New York')).toBeInTheDocument();
  });

  it('renders cabin class, flight number, and PNR', () => {
    render(<BoardingPass pass={samplePass} />);
    expect(screen.getByText('BUSINESS')).toBeInTheDocument();
    expect(screen.getByText('BA 287')).toBeInTheDocument();
    expect(screen.getByText(/X7K2HQ/)).toBeInTheDocument();
  });

  it('falls back to ECONOMY when cabin is omitted', () => {
    render(<BoardingPass pass={{ ...samplePass, cabin: undefined }} />);
    expect(screen.getByText('ECONOMY')).toBeInTheDocument();
  });

  it('returns null when pass prop is missing', () => {
    const { container } = render(<BoardingPass />);
    expect(container.firstChild).toBeNull();
  });
});

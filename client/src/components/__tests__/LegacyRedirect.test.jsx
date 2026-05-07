import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import LegacyRedirect from '../LegacyRedirect';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<><LegacyRedirect /><LocationProbe /></>} />
      <Route path="/aircraft/:slug" element={<LocationProbe />} />
      <Route path="/aircraft" element={<LocationProbe />} />
      <Route path="/map" element={<LocationProbe />} />
      <Route path="/search" element={<LocationProbe />} />
      <Route path="/by-aircraft" element={<LocationProbe />} />
    </Routes>
  );
}

describe('LegacyRedirect', () => {
  test('?mode=by-aircraft&family=787 redirects to /aircraft/boeing-787', () => {
    render(<MemoryRouter initialEntries={['/?mode=by-aircraft&family=787']}><App /></MemoryRouter>);
    expect(screen.getByTestId('loc').textContent).toBe('/aircraft/boeing-787');
  });

  test('?mode=by-aircraft&family=A380 redirects to /aircraft/airbus-a380', () => {
    render(<MemoryRouter initialEntries={['/?mode=by-aircraft&family=A380']}><App /></MemoryRouter>);
    expect(screen.getByTestId('loc').textContent).toBe('/aircraft/airbus-a380');
  });

  test('?mode=by-aircraft (no family) redirects to /by-aircraft', () => {
    // We keep the existing /by-aircraft route in Phase 1; rename in later phase
    render(<MemoryRouter initialEntries={['/?mode=by-aircraft']}><App /></MemoryRouter>);
    expect(screen.getByTestId('loc').textContent).toBe('/by-aircraft');
  });

  test('?mode=by-aircraft&family=unknown-xyz redirects to /by-aircraft (unknown slug fallback)', () => {
    render(<MemoryRouter initialEntries={['/?mode=by-aircraft&family=unknown-xyz']}><App /></MemoryRouter>);
    expect(screen.getByTestId('loc').textContent).toBe('/by-aircraft');
  });

  test('?mode=map redirects to /map', () => {
    render(<MemoryRouter initialEntries={['/?mode=map']}><App /></MemoryRouter>);
    expect(screen.getByTestId('loc').textContent).toBe('/map');
  });

  test('?from=LHR&to=JFK redirects to /search?from=LHR&to=JFK', () => {
    render(<MemoryRouter initialEntries={['/?from=LHR&to=JFK&date=2026-05-15']}><App /></MemoryRouter>);
    expect(screen.getByTestId('loc').textContent).toBe('/search?from=LHR&to=JFK&date=2026-05-15');
  });

  test('plain / does NOT redirect', () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  test('?from only (no to) does NOT redirect to /search', () => {
    render(<MemoryRouter initialEntries={['/?from=LHR']}><App /></MemoryRouter>);
    expect(screen.getByTestId('loc').textContent).toBe('/?from=LHR');
  });
});

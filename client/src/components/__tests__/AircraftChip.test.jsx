import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import AircraftChip from '../AircraftChip';

function Probe() {
  const [params] = useSearchParams();
  return <div data-testid="probe">{params.toString()}</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/search" element={<><AircraftChip /><Probe /></>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AircraftChip', () => {
  test('renders empty chip when URL has no aircraft param', () => {
    renderAt('/search');
    expect(screen.getByRole('button', { name: /\+ Aircraft/i })).toBeInTheDocument();
  });

  test('renders filled chip with summary when URL has aircraft', () => {
    renderAt('/search?aircraft=boeing-787,airbus-a380');
    expect(screen.getByRole('button', { name: /Boeing 787/i })).toBeInTheDocument();
  });

  test('clicking a checkbox adds the family to URL', () => {
    renderAt('/search');
    fireEvent.click(screen.getByRole('button', { name: /\+ Aircraft/i }));
    fireEvent.click(screen.getByLabelText(/Boeing 787/i));
    expect(screen.getByTestId('probe').textContent).toMatch(/aircraft=boeing-787/);
  });

  test('unchecking a checkbox removes that family', () => {
    renderAt('/search?aircraft=boeing-787,airbus-a380');
    fireEvent.click(screen.getByRole('button', { name: /Boeing 787/i }));
    fireEvent.click(screen.getByLabelText(/Boeing 787/i));
    expect(screen.getByTestId('probe').textContent).toMatch(/aircraft=airbus-a380/);
    expect(screen.getByTestId('probe').textContent).not.toMatch(/boeing-787/);
  });

  test('clicking ✕ on filled chip clears all aircraft', () => {
    renderAt('/search?aircraft=boeing-787,airbus-a380');
    fireEvent.click(screen.getByRole('button', { name: /clear aircraft/i }));
    expect(screen.getByTestId('probe').textContent).not.toMatch(/aircraft/);
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import SortMenu from '../SortMenu';

function Probe() {
  const [params] = useSearchParams();
  return <div data-testid="probe">{params.toString()}</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/search" element={<><SortMenu /><Probe /></>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SortMenu', () => {
  test('default selection is Cheapest when URL has no sort', () => {
    renderAt('/search');
    expect(screen.getByLabelText(/sort by/i)).toHaveValue('cheapest');
  });

  test('reads sort=safety from URL', () => {
    renderAt('/search?sort=safety');
    expect(screen.getByLabelText(/sort by/i)).toHaveValue('safety');
  });

  test('changing selection writes to URL', () => {
    renderAt('/search');
    fireEvent.change(screen.getByLabelText(/sort by/i), { target: { value: 'fastest' } });
    expect(screen.getByTestId('probe').textContent).toMatch(/sort=fastest/);
  });

  test('selecting cheapest (default) removes sort from URL', () => {
    renderAt('/search?sort=fastest');
    fireEvent.change(screen.getByLabelText(/sort by/i), { target: { value: 'cheapest' } });
    expect(screen.getByTestId('probe').textContent).not.toMatch(/sort=/);
  });
});

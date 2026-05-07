import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import AirlinesChip from '../AirlinesChip';
import { FilterOptionsContext } from '../../context/FilterOptionsContext';

function Probe() {
  const [params] = useSearchParams();
  return <div data-testid="probe">{params.toString()}</div>;
}

const filterOptions = {
  airlines: [
    { code: 'BA', name: 'British Airways' },
    { code: 'VS', name: 'Virgin Atlantic' },
    { code: 'AA', name: 'American Airlines' },
  ],
};

function renderAt(path) {
  return render(
    <FilterOptionsContext.Provider value={filterOptions}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/search" element={<><AirlinesChip /><Probe /></>} />
        </Routes>
      </MemoryRouter>
    </FilterOptionsContext.Provider>
  );
}

describe('AirlinesChip', () => {
  test('renders empty chip when URL has no airlines', () => {
    renderAt('/search');
    expect(screen.getByRole('button', { name: /\+ Airlines/i })).toBeInTheDocument();
  });

  test('clicking a checkbox adds the IATA code to URL', () => {
    renderAt('/search');
    fireEvent.click(screen.getByRole('button', { name: /\+ Airlines/i }));
    fireEvent.click(screen.getByLabelText(/British Airways/i));
    expect(screen.getByTestId('probe').textContent).toMatch(/airlines=BA/);
  });

  test('summary shows first airline + count of others', () => {
    renderAt('/search?airlines=BA,VS');
    expect(screen.getByRole('button', { name: /British Airways \+1/i })).toBeInTheDocument();
  });

  test('clicking ✕ clears all airlines', () => {
    renderAt('/search?airlines=BA,VS');
    fireEvent.click(screen.getByRole('button', { name: /clear airlines/i }));
    expect(screen.getByTestId('probe').textContent).not.toMatch(/airlines/);
  });

  test('renders empty list gracefully when filterOptions is null', () => {
    render(
      <FilterOptionsContext.Provider value={null}>
        <MemoryRouter initialEntries={['/search']}>
          <Routes>
            <Route path="/search" element={<AirlinesChip />} />
          </Routes>
        </MemoryRouter>
      </FilterOptionsContext.Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: /\+ Airlines/i }));
    // No checkboxes — no airlines in filterOptions
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

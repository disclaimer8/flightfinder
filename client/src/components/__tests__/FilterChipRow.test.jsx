import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FilterOptionsContext } from '../../context/FilterOptionsContext';
import FilterChipRow from '../FilterChipRow';

const filterOptions = { airlines: [{ code: 'BA', name: 'British Airways' }] };

describe('FilterChipRow', () => {
  test('renders Aircraft chip, Airlines chip, and Sort menu', () => {
    render(
      <FilterOptionsContext.Provider value={filterOptions}>
        <MemoryRouter><FilterChipRow /></MemoryRouter>
      </FilterOptionsContext.Provider>
    );
    expect(screen.getByRole('button', { name: /\+ Aircraft/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Airlines/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/sort by/i)).toBeInTheDocument();
  });
});

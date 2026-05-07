import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Search from '../Search';

test('Search renders with search test-id', () => {
  render(<MemoryRouter><Search /></MemoryRouter>);
  expect(screen.getByTestId('page-search')).toBeInTheDocument();
});

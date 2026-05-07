import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../Home';

test('Home renders with home test-id', () => {
  render(<MemoryRouter><Home /></MemoryRouter>);
  expect(screen.getByTestId('page-home')).toBeInTheDocument();
});

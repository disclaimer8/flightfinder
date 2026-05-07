import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Map from '../Map';

test('Map renders with map test-id', () => {
  render(<MemoryRouter><Map /></MemoryRouter>);
  expect(screen.getByTestId('page-map')).toBeInTheDocument();
});

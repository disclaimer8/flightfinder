import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AircraftBrowser from '../AircraftBrowser';

function renderBrowser() {
  return render(
    <MemoryRouter>
      <AircraftBrowser />
    </MemoryRouter>
  );
}

describe('AircraftBrowser', () => {
  test('renders "See all" link pointing to /aircraft', () => {
    renderBrowser();
    const link = screen.getByRole('link', { name: /see all/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/aircraft');
  });

  test('renders aircraft family chips as links to /aircraft/:slug', () => {
    renderBrowser();
    // Boeing 787 is always in the top families list
    const chip = screen.getByRole('link', { name: /787/i });
    expect(chip).toBeInTheDocument();
    expect(chip.getAttribute('href')).toMatch(/^\/aircraft\/boeing-787/);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SiteLayout from '../SiteLayout';
import { AuthProvider } from '../../context/AuthContext';

vi.mock('../../utils/platform', () => ({ isNativeApp: () => false }));

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ apiStatus: { ok: true } }) });
});

function withRouter(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route path="/safety/global" element={<div>safety content</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('SiteLayout', () => {
  it('renders header, child outlet, and footer', () => {
    withRouter(['/safety/global']);
    expect(screen.getByTestId('site-header')).toBeInTheDocument();
    expect(screen.getByText('safety content')).toBeInTheDocument();
    expect(screen.getAllByText(/FlightFinder/i).length).toBeGreaterThan(0);
  });

  it('opens AuthModal when Sign in is clicked', async () => {
    withRouter(['/safety/global']);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('dialog', { name: /sign in/i })).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SiteHeader from '../SiteHeader';
import { AuthProvider } from '../../context/AuthContext';

function renderHeader(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <SiteHeader onSignInClick={vi.fn()} onSignUpClick={vi.fn()} />
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ apiStatus: { ok: true } }) });
});

describe('SiteHeader', () => {
  it('renders all primary nav items on desktop', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /by aircraft/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /safety/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pricing/i })).toBeInTheDocument();
  });

  it('marks Safety active on /safety/global', () => {
    renderHeader(['/safety/global']);
    const safetyLink = screen.getByRole('link', { name: /safety/i });
    expect(safetyLink.className).toMatch(/active/);
  });

  it('marks By aircraft active on /aircraft/boeing-787', () => {
    renderHeader(['/aircraft/boeing-787']);
    const link = screen.getByRole('link', { name: /by aircraft/i });
    expect(link.className).toMatch(/active/);
  });

  it('marks By aircraft active on / when ?mode=by-aircraft', () => {
    renderHeader(['/?mode=by-aircraft']);
    const link = screen.getByRole('link', { name: /by aircraft/i });
    expect(link.className).toMatch(/active/);
  });

  it('opens mobile drawer when burger clicked', () => {
    renderHeader();
    const burger = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(burger);
    expect(screen.getByRole('dialog', { name: /site navigation/i })).toBeInTheDocument();
  });

  it('calls onSignInClick when Sign in clicked', () => {
    const onSignInClick = vi.fn();
    render(
      <MemoryRouter>
        <AuthProvider>
          <SiteHeader onSignInClick={onSignInClick} onSignUpClick={vi.fn()} />
        </AuthProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSignInClick).toHaveBeenCalled();
  });
});

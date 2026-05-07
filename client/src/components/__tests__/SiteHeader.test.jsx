import { describe, it, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SiteHeader from '../SiteHeader';
import { AuthProvider } from '../../context/AuthContext';
import { _resetForTests } from '../../hooks/useFilterOptions';

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

function renderHeaderPhase1(initialPath = '/') {
  _resetForTests();
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <SiteHeader onSignInClick={vi.fn()} onSignUpClick={vi.fn()} />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('SiteHeader nav links (search redesign Phase 1)', () => {
  test('Search link points to /search', () => {
    renderHeaderPhase1();
    const link = screen.getByRole('link', { name: 'Search' });
    expect(link).toHaveAttribute('href', '/search');
  });

  test('By aircraft link still points to /by-aircraft', () => {
    renderHeaderPhase1();
    const link = screen.getByRole('link', { name: 'By aircraft' });
    expect(link).toHaveAttribute('href', '/by-aircraft');
  });

  test('Map link is present and points to /map', () => {
    renderHeaderPhase1();
    const link = screen.getByRole('link', { name: 'Map' });
    expect(link).toHaveAttribute('href', '/map');
  });

  test('Safety link still points to /safety/global', () => {
    renderHeaderPhase1();
    const link = screen.getByRole('link', { name: 'Safety' });
    expect(link).toHaveAttribute('href', '/safety/global');
  });

  test('Search link is active when on /search', () => {
    renderHeaderPhase1('/search');
    const link = screen.getByRole('link', { name: 'Search' });
    expect(link.className).toMatch(/active/);
  });

  test('Map link is active when on /map', () => {
    renderHeaderPhase1('/map');
    const link = screen.getByRole('link', { name: 'Map' });
    expect(link.className).toMatch(/active/);
  });

  test('Search link is still active for legacy /?mode=search', () => {
    renderHeaderPhase1('/?mode=search');
    const link = screen.getByRole('link', { name: 'Search' });
    expect(link.className).toMatch(/active/);
  });
});

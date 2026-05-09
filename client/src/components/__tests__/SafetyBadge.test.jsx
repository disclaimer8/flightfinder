import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import SafetyBadge from '../SafetyBadge';

describe('SafetyBadge', () => {
  test('renders nothing when level=none', () => {
    const { container } = render(<SafetyBadge risk={{ level: 'none', label: '', summary: '' }} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders green badge with label', () => {
    render(<SafetyBadge risk={{ level: 'green', label: 'Clean recent record', summary: '' }} />);
    const badge = screen.getByText('Clean recent record').closest('.safety-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/safety-badge--green/);
  });

  test('renders yellow badge with summary as tooltip-like text', () => {
    render(<SafetyBadge risk={{ level: 'yellow', label: '2 incidents · 90d', summary: '12 historical' }} />);
    expect(screen.getByText('2 incidents · 90d')).toBeInTheDocument();
    expect(screen.getByText(/12 historical/i)).toBeInTheDocument();
  });

  test('renders red badge for fatal incident', () => {
    render(<SafetyBadge risk={{ level: 'red', label: '1 fatal incident · 90d', summary: '' }} />);
    const badge = screen.getByText('1 fatal incident · 90d').closest('.safety-badge');
    expect(badge.className).toMatch(/safety-badge--red/);
  });

  test('uses role=status for screen readers', () => {
    render(<SafetyBadge risk={{ level: 'green', label: 'OK', summary: '' }} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

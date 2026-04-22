import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UpgradeModal from '../components/UpgradeModal';

describe('UpgradeModal', () => {
  test('renders reason, CTA, and closes on backdrop click', () => {
    const onClose = vi.fn();
    render(<UpgradeModal open reason="Unlock on-time stats" onClose={onClose} />);
    expect(screen.getByText(/Unlock on-time stats/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /see plans/i })).toHaveAttribute('href', '/pricing');
    fireEvent.click(screen.getByTestId('upgrade-modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  test('returns null when open=false', () => {
    const { container } = render(<UpgradeModal open={false} reason="X" onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

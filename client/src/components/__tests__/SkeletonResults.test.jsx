import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SkeletonResults from '../SkeletonResults';

describe('SkeletonResults', () => {
  it('renders the loading message', () => {
    render(<SkeletonResults message="Searching flights…" />);
    expect(screen.getByText('Searching flights…')).toBeInTheDocument();
  });

  it('falls back to "Loading…" when no message provided', () => {
    render(<SkeletonResults />);
    // aria-label and visible text both set to 'Loading…'
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('has role="status" for screen readers', () => {
    render(<SkeletonResults message="Scanning destinations…" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

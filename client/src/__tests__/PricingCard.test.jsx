import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PricingCard } from '../components/PricingCard.jsx';

describe('PricingCard', () => {
  const base = {
    tier: 'pro_monthly',
    title: 'Pro Monthly',
    price: '$4.99',
    cadence: '/month',
    features: ['Enriched card', 'Delay predictions', 'My Trips'],
    onSelect: () => {},
  };

  it('renders price, title, features', () => {
    render(<PricingCard {...base} />);
    expect(screen.getByText('Pro Monthly')).toBeInTheDocument();
    expect(screen.getByText('$4.99')).toBeInTheDocument();
    expect(screen.getByText('Enriched card')).toBeInTheDocument();
  });

  it('fires onSelect with tier when CTA clicked', () => {
    const onSelect = vi.fn();
    render(<PricingCard {...base} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }));
    expect(onSelect).toHaveBeenCalledWith('pro_monthly');
  });

  it('shows sold-out badge and disables CTA when soldOut=true', () => {
    render(<PricingCard {...base} tier="pro_lifetime" soldOut />);
    expect(screen.getAllByText(/sold out/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows remaining counter when remaining is provided', () => {
    render(<PricingCard {...base} tier="pro_lifetime" remaining={42} />);
    expect(screen.getByText(/42 slots left/i)).toBeInTheDocument();
  });
});

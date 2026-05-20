import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapViewToggle from '../MapViewToggle';

describe('MapViewToggle', () => {
  it('renders both options with "network" selected by default', () => {
    const onChange = vi.fn();
    render(<MapViewToggle value="network" onChange={onChange} />);
    const network = screen.getByRole('button', { name: /network/i });
    const density = screen.getByRole('button', { name: /density/i });
    expect(network).toHaveAttribute('aria-pressed', 'true');
    expect(density).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects density as selected when value="density"', () => {
    render(<MapViewToggle value="density" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /density/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /network/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the new view when user clicks the inactive option', () => {
    const onChange = vi.fn();
    render(<MapViewToggle value="network" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /density/i }));
    expect(onChange).toHaveBeenCalledWith('density');
  });

  it('does not call onChange when clicking the already-active option', () => {
    const onChange = vi.fn();
    render(<MapViewToggle value="network" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /network/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

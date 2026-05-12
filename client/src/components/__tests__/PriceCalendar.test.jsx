import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import PriceCalendar from '../PriceCalendar';

const PRICES = [612, 589, 418, 489, 524, 678, 734, 612, 589, 432, 489, 612, 689, 758];

describe('PriceCalendar', () => {
  it('renders nothing when prices is empty', () => {
    const { container } = render(<PriceCalendar prices={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders 14 day cells with prices', () => {
    render(<PriceCalendar prices={PRICES} startDate="2026-05-04" route="LHR → JFK" />);
    expect(screen.getAllByText(/^\$\d+$/).length).toBeGreaterThanOrEqual(14);
    expect(screen.getByText('Prices · LHR → JFK')).toBeInTheDocument();
  });

  it('shows "Cheapest" ribbon on the minimum-price day', () => {
    const { container } = render(<PriceCalendar prices={PRICES} startDate="2026-05-04" />);
    expect(container.querySelector('.is-cheapest')).not.toBeNull();
  });

  it('selecting a different day updates aria-pressed + savings hint', () => {
    render(<PriceCalendar prices={PRICES} startDate="2026-05-04" />);
    const days = screen.getAllByRole('listitem');
    // Click the highest-priced day (index 13, $758)
    fireEvent.click(days[13]);
    expect(days[13].getAttribute('aria-pressed')).toBe('true');
    // 758 - 418 = $340 savings vs cheapest
    expect(screen.getByText(/save/i).textContent).toMatch(/\$340/);
  });

  it('invokes onSelect with the picked date + price', () => {
    const onSelect = vi.fn();
    render(<PriceCalendar prices={PRICES} startDate="2026-05-04" onSelect={onSelect} />);
    const days = screen.getAllByRole('listitem');
    fireEvent.click(days[5]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][1]).toBe(PRICES[5]);
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import FilterChip from '../FilterChip';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
});

function renderChip(props = {}) {
  return render(
    <FilterChip
      label="Aircraft"
      summary={props.summary}
      hasValue={props.hasValue || false}
      onClear={props.onClear}
    >
      <div data-testid="popover-content">popover body</div>
    </FilterChip>
  );
}

describe('FilterChip primitive', () => {
  test('renders empty chip with "+ Aircraft" label', () => {
    renderChip();
    expect(screen.getByRole('button', { name: /\+ Aircraft/i })).toBeInTheDocument();
  });

  test('renders filled chip with summary text', () => {
    renderChip({ hasValue: true, summary: '787, A380' });
    expect(screen.getByRole('button', { name: /787, A380/i })).toBeInTheDocument();
  });

  test('clicking the trigger opens the popover', () => {
    renderChip();
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /\+ Aircraft/i }));
    expect(screen.getByTestId('popover-content')).toBeInTheDocument();
  });

  test('ESC closes the popover', () => {
    renderChip();
    fireEvent.click(screen.getByRole('button', { name: /\+ Aircraft/i }));
    expect(screen.getByTestId('popover-content')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument();
  });

  test('clicking outside closes the popover', () => {
    renderChip();
    fireEvent.click(screen.getByRole('button', { name: /\+ Aircraft/i }));
    expect(screen.getByTestId('popover-content')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument();
  });

  test('filled chip shows ✕ clear affordance which calls onClear', () => {
    const onClear = vi.fn();
    renderChip({ hasValue: true, summary: '787', onClear });
    const clearBtn = screen.getByRole('button', { name: /clear aircraft/i });
    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalled();
  });

  test('clicking ✕ does NOT open the popover', () => {
    const onClear = vi.fn();
    renderChip({ hasValue: true, summary: '787', onClear });
    fireEvent.click(screen.getByRole('button', { name: /clear aircraft/i }));
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument();
  });
});

describe('FilterChip mobile bottom-sheet', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
  });

  test('mobile renders bottom-sheet variant on open', () => {
    renderChip();
    fireEvent.click(screen.getByRole('button', { name: /\+ Aircraft/i }));
    const popover = screen.getByTestId('popover-content').closest('.filter-chip-popover');
    expect(popover.className).toMatch(/bottom-sheet/);
  });
});

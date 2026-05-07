import { render } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import ScrollRestoration from '../ScrollRestoration';

beforeEach(() => {
  // Reset history state before each test
  window.history.replaceState({}, '');
  window.scrollTo = vi.fn();
  // jsdom requires explicit RAF stub
  window.requestAnimationFrame = (cb) => { cb(); return 1; };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScrollRestoration', () => {
  test('does nothing when ready=false', () => {
    render(<ScrollRestoration ready={false} />);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  test('does nothing when history has no scrollY', () => {
    render(<ScrollRestoration ready={true} />);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  test('restores scroll when ready=true and history has scrollY', () => {
    window.history.replaceState({ scrollY: 1234 }, '');
    render(<ScrollRestoration ready={true} />);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 1234);
  });

  test('clears saved scrollY after restore (one-shot)', () => {
    window.history.replaceState({ scrollY: 1234, other: 'kept' }, '');
    render(<ScrollRestoration ready={true} />);
    expect(window.history.state.scrollY).toBeUndefined();
    expect(window.history.state.other).toBe('kept');
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, test, expect } from 'vitest';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import SearchFormBar from '../SearchFormBar';

function Probe() {
  const [params] = useSearchParams();
  return <div data-testid="probe">{params.toString()}</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/search" element={<>
          <SearchFormBar />
          <Probe />
        </>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SearchFormBar', () => {
  test('reads from URL: prefills From/To/Date inputs', () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15');
    expect(screen.getByLabelText(/from/i)).toHaveValue('LHR');
    expect(screen.getByLabelText(/to/i)).toHaveValue('JFK');
    expect(screen.getByLabelText(/^date$/i)).toHaveValue('2099-01-15');
  });

  test('typing in "From" updates URL with uppercased value', () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15');
    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: 'cdg' } });
    expect(screen.getByTestId('probe').textContent).toMatch(/from=CDG/);
  });

  test('toggling Direct flips direct param', () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15');
    const cb = screen.getByLabelText(/direct only/i);
    expect(cb).not.toBeChecked();
    fireEvent.click(cb);
    expect(screen.getByTestId('probe').textContent).toMatch(/direct=1/);
  });

  test('toggling Flexible dates flips flex_dates param', () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15');
    const cb = screen.getByLabelText(/flexible/i);
    fireEvent.click(cb);
    expect(screen.getByTestId('probe').textContent).toMatch(/flex_dates=1/);
  });

  test('changing Cabin select updates URL', () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15');
    const sel = screen.getByLabelText(/cabin/i);
    fireEvent.change(sel, { target: { value: 'business' } });
    expect(screen.getByTestId('probe').textContent).toMatch(/cabin=business/);
  });

  test('changing Pax select updates URL', () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15');
    const sel = screen.getByLabelText(/passengers/i);
    fireEvent.change(sel, { target: { value: '3' } });
    expect(screen.getByTestId('probe').textContent).toMatch(/pax=3/);
  });

  test('From input limits to 3 characters', () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15');
    const input = screen.getByLabelText(/from/i);
    expect(input).toHaveAttribute('maxLength', '3');
  });

  test('changing a search-affecting field resets shown to 7 (drop stale page count)', () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15&shown=37');
    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: 'cdg' } });
    const qs = screen.getByTestId('probe').textContent;
    expect(qs).toMatch(/from=CDG/);
    // shown=37 must be dropped (back to default 7, which serializeSearchParams
    // omits from the URL entirely)
    expect(qs).not.toMatch(/shown=37/);
  });

  test('changing a filter-only field (direct) does NOT reset shown', () => {
    renderAt('/search?from=LHR&to=JFK&date=2099-01-15&shown=37');
    fireEvent.click(screen.getByLabelText(/direct only/i));
    const qs = screen.getByTestId('probe').textContent;
    expect(qs).toMatch(/direct=1/);
    expect(qs).toMatch(/shown=37/); // preserved
  });
});

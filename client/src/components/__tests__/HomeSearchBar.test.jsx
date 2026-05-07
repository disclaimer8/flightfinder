import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HomeSearchBar from '../HomeSearchBar';

// Capture navigate calls
let capturedNavigate = null;
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => (to) => { capturedNavigate = to; },
  };
});

function renderBar() {
  capturedNavigate = null;
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<HomeSearchBar />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('HomeSearchBar', () => {
  test('renders From, To, Depart, Return, and Pax inputs', () => {
    renderBar();
    expect(screen.getByLabelText(/^from$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^to$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/depart/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/return/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/passengers/i)).toBeInTheDocument();
  });

  test('renders Direct only and Flexible dates checkboxes', () => {
    renderBar();
    expect(screen.getByLabelText(/direct only/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/flexible/i)).toBeInTheDocument();
  });

  test('renders a Search button', () => {
    renderBar();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  test('navigates to /search with from, to, date on valid submit', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: 'LHR' } });
    fireEvent.change(screen.getByLabelText(/^to$/i),   { target: { value: 'JFK' } });
    fireEvent.change(screen.getByLabelText(/depart/i), { target: { value: '2099-06-15' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(capturedNavigate).toMatch(/^\/search\?/);
    expect(capturedNavigate).toMatch(/from=LHR/);
    expect(capturedNavigate).toMatch(/to=JFK/);
    expect(capturedNavigate).toMatch(/date=2099-06-15/);
  });

  test('blocks submit when from === to', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: 'LHR' } });
    fireEvent.change(screen.getByLabelText(/^to$/i),   { target: { value: 'LHR' } });
    fireEvent.change(screen.getByLabelText(/depart/i), { target: { value: '2099-06-15' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(capturedNavigate).toBeNull();
  });

  test('blocks submit when required fields are missing', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(capturedNavigate).toBeNull();
  });

  test('uppercases From and To values', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: 'lhr' } });
    expect(screen.getByLabelText(/^from$/i)).toHaveValue('LHR');
  });

  test('includes pax=2 in URL when passengers changed to 2', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: 'LHR' } });
    fireEvent.change(screen.getByLabelText(/^to$/i),   { target: { value: 'JFK' } });
    fireEvent.change(screen.getByLabelText(/depart/i), { target: { value: '2099-06-15' } });
    fireEvent.change(screen.getByLabelText(/passengers/i), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(capturedNavigate).toMatch(/pax=2/);
  });

  test('includes direct=1 in URL when Direct only checked', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: 'LHR' } });
    fireEvent.change(screen.getByLabelText(/^to$/i),   { target: { value: 'JFK' } });
    fireEvent.change(screen.getByLabelText(/depart/i), { target: { value: '2099-06-15' } });
    fireEvent.click(screen.getByLabelText(/direct only/i));
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(capturedNavigate).toMatch(/direct=1/);
  });

  test('includes flex_dates=1 in URL when Flexible dates checked', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: 'LHR' } });
    fireEvent.change(screen.getByLabelText(/^to$/i),   { target: { value: 'JFK' } });
    fireEvent.change(screen.getByLabelText(/depart/i), { target: { value: '2099-06-15' } });
    fireEvent.click(screen.getByLabelText(/flexible/i));
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(capturedNavigate).toMatch(/flex_dates=1/);
  });

  test('rejects past departure date with inline error', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: 'LHR' } });
    fireEvent.change(screen.getByLabelText(/^to$/i),   { target: { value: 'JFK' } });
    fireEvent.change(screen.getByLabelText(/depart/i), { target: { value: '2020-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/past/i);
    expect(capturedNavigate).toBeNull();
  });

  test('rejects return date earlier than depart with inline error', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: 'LHR' } });
    fireEvent.change(screen.getByLabelText(/^to$/i),   { target: { value: 'JFK' } });
    fireEvent.change(screen.getByLabelText(/depart/i), { target: { value: '2099-06-15' } });
    fireEvent.change(screen.getByLabelText(/return/i), { target: { value: '2099-06-10' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/return/i);
    expect(capturedNavigate).toBeNull();
  });

  test('Depart input has min=today (browser-level guard)', () => {
    renderBar();
    const depart = screen.getByLabelText(/depart/i);
    const today = new Date().toISOString().slice(0, 10);
    expect(depart).toHaveAttribute('min', today);
  });
});

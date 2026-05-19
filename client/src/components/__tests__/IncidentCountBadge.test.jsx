import { render, screen } from '@testing-library/react';
import IncidentCountBadge from '../IncidentCountBadge';

describe('IncidentCountBadge', () => {
  it('renders "No incidents 5y" for count 0', () => {
    render(<IncidentCountBadge level="green" count={0} />);
    expect(screen.getByText(/No incidents 5y/)).toBeInTheDocument();
  });

  it('renders singular "1 incident 5y"', () => {
    render(<IncidentCountBadge level="yellow" count={1} />);
    expect(screen.getByText(/1 incident 5y/)).toBeInTheDocument();
    expect(screen.queryByText(/incidents/)).toBeNull();
  });

  it('renders plural "N incidents 5y" for count > 1', () => {
    render(<IncidentCountBadge level="red" count={5} />);
    expect(screen.getByText(/5 incidents 5y/)).toBeInTheDocument();
  });

  it('applies level-specific border color via inline style', () => {
    const { container: g } = render(<IncidentCountBadge level="green" count={0} />);
    const { container: y } = render(<IncidentCountBadge level="yellow" count={2} />);
    const { container: r } = render(<IncidentCountBadge level="red" count={10} />);
    expect(g.firstChild).toHaveStyle('color: rgb(58, 141, 58)');
    expect(y.firstChild).toHaveStyle('color: rgb(201, 139, 31)');
    expect(r.firstChild).toHaveStyle('color: rgb(194, 54, 42)');
  });
});

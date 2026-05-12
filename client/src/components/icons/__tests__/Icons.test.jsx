import { render } from '@testing-library/react';
import * as Icons from '../Icons';

describe('Icons kit', () => {
  it('exports 20 Lucide-style named icons', () => {
    const names = Object.keys(Icons);
    expect(names.length).toBe(20);
  });

  it.each(Object.entries(Icons))('<%s/> renders an SVG with the expected shape', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('width')).toBe('22');
    expect(svg.getAttribute('height')).toBe('22');
  });

  it('size + strokeWidth + className override defaults', () => {
    const { container } = render(<Icons.Search size={32} strokeWidth={1.5} className="text-primary" />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('height')).toBe('32');
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    expect(svg.getAttribute('class')).toBe('text-primary');
  });

  it('title prop exposes the icon to assistive tech', () => {
    const { container } = render(<Icons.Plane title="Aircraft" />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(container.querySelector('title').textContent).toBe('Aircraft');
  });

  it('omits role + sets aria-hidden by default (decorative)', () => {
    const { container } = render(<Icons.Plane />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
  });
});

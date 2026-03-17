import { describe, it, expect } from 'vitest';
import { formatTime, formatDate, formatShortDate } from '../formatters';

describe('formatTime', () => {
  it('returns em-dash for null', () => {
    expect(formatTime(null)).toBe('—');
  });

  it('formats an ISO timestamp to HH:MM', () => {
    // Use a fixed UTC time; toLocaleTimeString is locale-dependent so just check the pattern
    const result = formatTime('2024-06-01T14:30:00');
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('formatDate', () => {
  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('');
  });

  it('includes month, day, and year', () => {
    const result = formatDate('2024-06-01T10:00:00');
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/2024/);
  });
});

describe('formatShortDate', () => {
  it('returns empty string for null', () => {
    expect(formatShortDate(null)).toBe('');
  });

  it('includes month and day but not year', () => {
    const result = formatShortDate('2024-06-01T10:00:00');
    expect(result).toMatch(/Jun/);
    expect(result).not.toMatch(/2024/);
  });
});

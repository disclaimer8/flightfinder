import { describe, it, expect } from 'vitest';
import { parseDurationMins, getTimeSlot, buildFlightParams } from '../flightUtils';

describe('parseDurationMins', () => {
  it('parses hours and minutes', () => {
    expect(parseDurationMins('2h 35m')).toBe(155);
  });

  it('parses hours only', () => {
    expect(parseDurationMins('10h')).toBe(600);
  });

  it('parses minutes only', () => {
    expect(parseDurationMins('45m')).toBe(45);
  });

  it('returns Infinity for null', () => {
    expect(parseDurationMins(null)).toBe(Infinity);
  });

  it('returns Infinity for empty string', () => {
    expect(parseDurationMins('')).toBe(Infinity);
  });
});

describe('getTimeSlot', () => {
  const makeISO = (hour) => {
    const d = new Date(2024, 0, 15, hour, 0, 0);
    return d.toISOString();
  };

  it('classifies 00:00 as night', () => {
    expect(getTimeSlot(makeISO(0))).toBe('night');
  });

  it('classifies 05:59 as night', () => {
    expect(getTimeSlot(makeISO(5))).toBe('night');
  });

  it('classifies 06:00 as morning', () => {
    expect(getTimeSlot(makeISO(6))).toBe('morning');
  });

  it('classifies 11:59 as morning', () => {
    expect(getTimeSlot(makeISO(11))).toBe('morning');
  });

  it('classifies 12:00 as afternoon', () => {
    expect(getTimeSlot(makeISO(12))).toBe('afternoon');
  });

  it('classifies 17:59 as afternoon', () => {
    expect(getTimeSlot(makeISO(17))).toBe('afternoon');
  });

  it('classifies 18:00 as evening', () => {
    expect(getTimeSlot(makeISO(18))).toBe('evening');
  });

  it('classifies 23:59 as evening', () => {
    expect(getTimeSlot(makeISO(23))).toBe('evening');
  });
});

describe('buildFlightParams', () => {
  it('includes all provided fields', () => {
    const params = buildFlightParams({
      departure: 'JFK',
      arrival: 'LAX',
      date: '2024-06-01',
      passengers: '2',
      aircraftType: 'jet',
      aircraftModel: 'B738',
      returnDate: '2024-06-10',
      api: 'amadeus',
    });
    expect(params.get('departure')).toBe('JFK');
    expect(params.get('arrival')).toBe('LAX');
    expect(params.get('passengers')).toBe('2');
    expect(params.get('aircraftType')).toBe('jet');
    expect(params.get('returnDate')).toBe('2024-06-10');
  });

  it('omits empty/falsy fields', () => {
    const params = buildFlightParams({ departure: 'JFK', arrival: '', aircraftType: '' });
    expect(params.get('departure')).toBe('JFK');
    expect(params.has('arrival')).toBe(false);
    expect(params.has('aircraftType')).toBe(false);
  });
});

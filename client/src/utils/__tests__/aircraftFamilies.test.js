import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFamilies, findFamilySlugForModel, _resetForTests } from '../aircraftFamilies';

const FIXTURE = [
  { slug: 'boeing-737', label: 'Boeing 737', modelPrefixes: ['Boeing 737', 'B737', 'B738', 'B739'] },
  { slug: 'airbus-a320', label: 'Airbus A320', modelPrefixes: ['Airbus A320', 'A320', 'A20N'] },
  { slug: 'cessna-172', label: 'Cessna 172', modelPrefixes: ['Cessna 172'] },
];

beforeEach(() => {
  _resetForTests();
  vi.restoreAllMocks();
});

describe('findFamilySlugForModel', () => {
  it('matches by full label prefix', () => {
    expect(findFamilySlugForModel('Boeing 737-800', FIXTURE)).toBe('boeing-737');
    expect(findFamilySlugForModel('Airbus A320-200', FIXTURE)).toBe('airbus-a320');
  });

  it('matches by ICAO code', () => {
    expect(findFamilySlugForModel('B738', FIXTURE)).toBe('boeing-737');
    expect(findFamilySlugForModel('A20N', FIXTURE)).toBe('airbus-a320');
  });

  it('is case-insensitive', () => {
    expect(findFamilySlugForModel('boeing 737-800', FIXTURE)).toBe('boeing-737');
  });

  it('returns null when no prefix matches', () => {
    expect(findFamilySlugForModel('Embraer E175', FIXTURE)).toBeNull();
  });

  it('returns null on falsy / non-string input', () => {
    expect(findFamilySlugForModel(null, FIXTURE)).toBeNull();
    expect(findFamilySlugForModel('', FIXTURE)).toBeNull();
    expect(findFamilySlugForModel('Boeing 737', null)).toBeNull();
  });
});

describe('loadFamilies', () => {
  it('fetches the JSON once and reuses the resolved value', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => FIXTURE,
    });

    const a = await loadFamilies();
    const b = await loadFamilies();

    expect(a).toEqual(FIXTURE);
    expect(b).toBe(a);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves to [] on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false });
    const result = await loadFamilies();
    expect(result).toEqual([]);
  });

  it('resolves to [] on network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('net'));
    const result = await loadFamilies();
    expect(result).toEqual([]);
  });
});

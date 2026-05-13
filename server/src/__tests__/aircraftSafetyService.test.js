jest.mock('../models/safetyEvents', () => ({
  getByAircraftCodes: jest.fn(),
}));
jest.mock('../services/sidecarAccidentsClient', () => ({
  findAccidentsByFamilyPatterns: jest.fn(),
}));

const safetyEvents = require('../models/safetyEvents');
const sidecar = require('../services/sidecarAccidentsClient');
const svc = require('../services/aircraftSafetyService');

beforeEach(() => {
  jest.clearAllMocks();
  safetyEvents.getByAircraftCodes.mockReturnValue([]);
  sidecar.findAccidentsByFamilyPatterns.mockReturnValue([]);
});

describe('expandFamilyPatterns', () => {
  test('simple family → single pattern', () => {
    expect(svc.expandFamilyPatterns('Boeing 787')).toEqual(['Boeing 787']);
    expect(svc.expandFamilyPatterns('Airbus A320')).toEqual(['Airbus A320']);
  });
  test('slash-collated → split + prefixed', () => {
    expect(svc.expandFamilyPatterns('Embraer E170/E175')).toEqual(['Embraer E170', 'Embraer E175']);
    expect(svc.expandFamilyPatterns('ATR 42/72')).toEqual(['ATR 42', 'ATR 72']);
    expect(svc.expandFamilyPatterns('Embraer E190/E195')).toEqual(['Embraer E190', 'Embraer E195']);
  });
  test('Airbus A320 family meta → A319/A320/A321 individual patterns', () => {
    expect(svc.expandFamilyPatterns('Airbus A320 family')).toEqual([
      'Airbus A319', 'Airbus A320', 'Airbus A321',
    ]);
  });
  test('Bombardier Dash 8 → Dash 8 + Q400 marketing alias', () => {
    expect(svc.expandFamilyPatterns('Bombardier Dash 8')).toEqual(['Dash 8', 'Q400']);
  });
  test('empty / non-string → empty array', () => {
    expect(svc.expandFamilyPatterns(null)).toEqual([]);
    expect(svc.expandFamilyPatterns('')).toEqual([]);
    expect(svc.expandFamilyPatterns(123)).toEqual([]);
  });
});

describe('parseFatalities', () => {
  test('integer string', () => expect(svc.parseFatalities('5')).toBe(5));
  test('zero', () => expect(svc.parseFatalities('0')).toBe(0));
  test('passengers + ground', () => expect(svc.parseFatalities('241+19')).toBe(260));
  test('empty / null', () => {
    expect(svc.parseFatalities('')).toBe(0);
    expect(svc.parseFatalities(null)).toBe(0);
    expect(svc.parseFatalities(undefined)).toBe(0);
  });
  test('NTSB codes', () => {
    expect(svc.parseFatalities('INH')).toBe(0);
    expect(svc.parseFatalities('?')).toBe(0);
    expect(svc.parseFatalities('Unknown')).toBe(0);
    expect(svc.parseFatalities('N/A')).toBe(0);
  });
  test('embedded integer', () => expect(svc.parseFatalities('1 of 2')).toBe(3));   // 1 + 2
  test('with prefix', () => expect(svc.parseFatalities('estimated 30')).toBe(30));
});

describe('parseDateToEpoch', () => {
  test('valid ISO date', () => {
    const ms = svc.parseDateToEpoch('2025-06-12');
    expect(ms).toBe(Date.parse('2025-06-12T00:00:00Z'));
  });
  test('partial date returns null', () => {
    expect(svc.parseDateToEpoch('xx Sep 2012')).toBeNull();
    expect(svc.parseDateToEpoch('2012-09')).toBeNull();
  });
  test('null/empty', () => {
    expect(svc.parseDateToEpoch(null)).toBeNull();
    expect(svc.parseDateToEpoch('')).toBeNull();
  });
});

describe('adaptAccidentToEvent', () => {
  test('full hull-loss row maps to fatal severity + hull_loss=1', () => {
    const row = {
      id: 41900,
      normalized_date: '2025-06-12',
      aircraft_model: 'Boeing 787-8 Dreamliner',
      operator: 'Air India',
      fatalities: '241+19',
      location: 'near Sardar Vallabhbhai Patel International Apt., Ahmedabad',
      source_url: 'https://aviation-safety.net/wikibase/123',
    };
    const ev = svc.adaptAccidentToEvent(row);
    expect(ev.id).toBe('ac_41900');
    expect(ev.source).toBe('aircrash');
    expect(ev.source_event_id).toBe('41900');
    expect(ev.severity).toBe('fatal');
    expect(ev.hull_loss).toBe(1);
    expect(ev.fatalities).toBe(260);
    expect(ev.operator_name).toBe('Air India');
    expect(ev.aircraft_model_text).toBe('Boeing 787-8 Dreamliner');
    expect(ev.occurred_at).toBe(Date.parse('2025-06-12T00:00:00Z'));
    expect(ev.report_url).toBe('https://aviation-safety.net/wikibase/123');
  });
  test('zero-fatalities row maps to incident severity + hull_loss=0', () => {
    const row = { id: 1, normalized_date: '2024-01-01', fatalities: '0' };
    const ev = svc.adaptAccidentToEvent(row);
    expect(ev.severity).toBe('incident');
    expect(ev.hull_loss).toBe(0);
    expect(ev.fatalities).toBe(0);
  });
  test('comma-merged source_url takes the first', () => {
    const row = { id: 2, normalized_date: '2024-01-01', fatalities: '0',
                  source_url: 'https://a.com/1, https://b.com/2' };
    expect(svc.adaptAccidentToEvent(row).report_url).toBe('https://a.com/1');
  });
});

describe('dedupe', () => {
  test('keeps the higher-fatality row for same day + same operator first-token', () => {
    const t = Date.parse('2025-06-12T00:00:00Z');
    const a = { id: 'a', occurred_at: t, operator_name: 'Air India',  fatalities: 0 };
    const b = { id: 'b', occurred_at: t, operator_name: 'Air India',  fatalities: 260 };
    const c = { id: 'c', occurred_at: t, operator_name: 'United Airlines', fatalities: 0 };  // different operator → kept
    const out = svc.dedupe([a, b, c]);
    const ids = out.map(e => e.id).sort();
    expect(ids).toEqual(['b', 'c']);  // a (0 fatalities) replaced by b (260)
  });
  test('events without occurred_at pass through unchanged', () => {
    const a = { id: 'a', occurred_at: null, fatalities: 0 };
    const b = { id: 'b', occurred_at: null, fatalities: 5 };
    expect(svc.dedupe([a, b])).toHaveLength(2);
  });
});

describe('getMergedEventsForFamily', () => {
  test('merges both sources, sorts DESC, applies limit', () => {
    const t1 = Date.parse('2024-01-01T00:00:00Z');
    const t2 = Date.parse('2025-06-12T00:00:00Z');
    safetyEvents.getByAircraftCodes.mockReturnValue([
      { id: 7, occurred_at: t1, aircraft_icao_type: 'B789', operator_iata: 'UA', fatalities: 0, severity: 'incident', hull_loss: 0 },
    ]);
    sidecar.findAccidentsByFamilyPatterns.mockReturnValue([
      { id: 41900, normalized_date: '2025-06-12', aircraft_model: 'Boeing 787-8', operator: 'Air India', fatalities: '241+19' },
    ]);
    const out = svc.getMergedEventsForFamily({
      icaoList: ['B788', 'B789'], familyName: 'Boeing 787', limit: 10,
    });
    expect(out).toHaveLength(2);
    expect(out[0].occurred_at).toBe(t2);     // newer first
    expect(out[0].fatalities).toBe(260);
    expect(out[1].occurred_at).toBe(t1);
  });

  test('fatalOnly filters to events with deaths', () => {
    safetyEvents.getByAircraftCodes.mockReturnValue([
      { id: 1, occurred_at: 1000, fatalities: 0, severity: 'incident', hull_loss: 0 },
      { id: 2, occurred_at: 2000, fatalities: 5, severity: 'fatal',    hull_loss: 1 },
    ]);
    const out = svc.getMergedEventsForFamily({
      icaoList: ['B789'], familyName: 'Boeing 787', fatalOnly: true,
    });
    expect(out.map(e => e.id)).toEqual([2]);
  });

  test('fatalOnly path calls sidecar with fatalOnly:true ONLY (no recency)', () => {
    svc.getMergedEventsForFamily({ icaoList: ['B738'], familyName: 'Boeing 737', fatalOnly: true });
    const calls = sidecar.findAccidentsByFamilyPatterns.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ fatalOnly: true });
  });

  test('default path calls sidecar TWICE: all-time fatal + recency top-N', () => {
    svc.getMergedEventsForFamily({ icaoList: ['B738'], familyName: 'Boeing 737' });
    const calls = sidecar.findAccidentsByFamilyPatterns.mock.calls;
    expect(calls).toHaveLength(2);
    const optsList = calls.map((c) => c[1]);
    expect(optsList.some((o) => o.fatalOnly === true)).toBe(true);
    expect(optsList.some((o) => !o.fatalOnly && typeof o.limit === 'number')).toBe(true);
  });

  test('default path surfaces old fatal events outside recency window', () => {
    const t_old = Date.parse('2018-10-29T00:00:00Z');
    sidecar.findAccidentsByFamilyPatterns
      .mockImplementationOnce(() => [
        { id: 41527, normalized_date: '2018-10-29', operator: 'Lion Air', fatalities: '189', aircraft_model: 'Boeing 737 MAX 8' },
      ])
      .mockImplementationOnce(() => Array.from({ length: 100 }, (_, i) => ({
        id: 90000 + i, normalized_date: '2026-04-15', operator: 'Recent Op',
        fatalities: '0', aircraft_model: 'Boeing 737-800',
      })));
    const out = svc.getMergedEventsForFamily({
      icaoList: ['B738'], familyName: 'Boeing 737', limit: 100,
    });
    const lionAir = out.find((e) => e.fatalities === 189);
    expect(lionAir).toBeDefined();
    expect(lionAir.occurred_at).toBe(t_old);
  });

  test('fatal-first slice preserves ALL fatal even when recent saturates the cap', () => {
    // 5 distinct fatal events from older years + 100 modern incidents.
    // Total candidates > limit=100. Naive date-DESC slice would drop the
    // 5 older fatal events; the fatal-first reservation guarantees they stay.
    const fatalRows = [
      { id: 1, normalized_date: '2018-10-29', operator: 'Lion Air',         fatalities: '189', aircraft_model: 'Boeing 737 MAX 8' },
      { id: 2, normalized_date: '2019-03-10', operator: 'Ethiopian',        fatalities: '157', aircraft_model: 'Boeing 737 MAX' },
      { id: 3, normalized_date: '2020-01-08', operator: 'Ukraine Intl',     fatalities: '176', aircraft_model: 'Boeing 737-800' },
      { id: 4, normalized_date: '2024-12-29', operator: 'Jeju Air',         fatalities: '173', aircraft_model: 'Boeing 737-800' },
      { id: 5, normalized_date: '2010-05-22', operator: 'Air India Charters', fatalities: '158', aircraft_model: 'Boeing 737-800' },
    ];
    const recentRows = Array.from({ length: 100 }, (_, i) => ({
      id: 90000 + i, normalized_date: '2026-04-15', operator: `Op${i}`,
      fatalities: '0', aircraft_model: 'Boeing 737-800',
    }));
    sidecar.findAccidentsByFamilyPatterns
      .mockImplementationOnce(() => fatalRows)
      .mockImplementationOnce(() => recentRows);
    const out = svc.getMergedEventsForFamily({
      icaoList: ['B738'], familyName: 'Boeing 737', limit: 100,
    });
    expect(out).toHaveLength(100);
    const fatalCount = out.filter((e) => e.fatalities > 0).length;
    expect(fatalCount).toBe(5);
    expect(out.filter((e) => e.fatalities === 189)).toHaveLength(1);
    expect(out.filter((e) => e.fatalities === 157)).toHaveLength(1);
    expect(out.filter((e) => e.fatalities === 173)).toHaveLength(1);
  });

  test('slash-family expands patterns before calling sidecar', () => {
    svc.getMergedEventsForFamily({ icaoList: [], familyName: 'ATR 42/72', fatalOnly: true });
    expect(sidecar.findAccidentsByFamilyPatterns).toHaveBeenCalledWith(
      ['ATR 42', 'ATR 72'],
      expect.objectContaining({ fatalOnly: true }),
    );
  });

  test('no icaoList → still queries sidecar by family name', () => {
    sidecar.findAccidentsByFamilyPatterns.mockReturnValue([
      { id: 99, normalized_date: '2024-01-01', fatalities: '0' },
    ]);
    const out = svc.getMergedEventsForFamily({
      icaoList: [], familyName: 'Boeing 787',
    });
    expect(safetyEvents.getByAircraftCodes).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ac_99');
  });

  test('no familyName → only safety_events', () => {
    safetyEvents.getByAircraftCodes.mockReturnValue([
      { id: 1, occurred_at: 1000, fatalities: 0 },
    ]);
    const out = svc.getMergedEventsForFamily({ icaoList: ['B789'], familyName: '' });
    expect(sidecar.findAccidentsByFamilyPatterns).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });

  test('sidecar throws → silently degrades to safety_events only', () => {
    safetyEvents.getByAircraftCodes.mockReturnValue([
      { id: 1, occurred_at: 1000, fatalities: 0 },
    ]);
    sidecar.findAccidentsByFamilyPatterns.mockImplementation(() => { throw new Error('sidecar down'); });
    const out = svc.getMergedEventsForFamily({ icaoList: ['B789'], familyName: 'Boeing 787' });
    expect(out).toHaveLength(1);
  });

  test('dedup runs across merged sources by (date, operator)', () => {
    const t = Date.parse('2025-06-12T00:00:00Z');
    safetyEvents.getByAircraftCodes.mockReturnValue([
      { id: 10, occurred_at: t, operator_name: 'Air India', fatalities: 0, severity: 'incident' },
    ]);
    sidecar.findAccidentsByFamilyPatterns.mockReturnValue([
      { id: 41900, normalized_date: '2025-06-12', operator: 'Air India', fatalities: '241+19' },
    ]);
    const out = svc.getMergedEventsForFamily({
      icaoList: ['B789'], familyName: 'Boeing 787',
    });
    expect(out).toHaveLength(1);
    expect(out[0].fatalities).toBe(260);    // higher-fatality version kept
  });
});

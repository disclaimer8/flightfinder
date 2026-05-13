jest.mock('../models/safetyEvents', () => ({
  getByAircraftCodes: jest.fn(),
}));
jest.mock('../services/sidecarAccidentsClient', () => ({
  findAccidentsByFamilyName: jest.fn(),
}));

const safetyEvents = require('../models/safetyEvents');
const sidecar = require('../services/sidecarAccidentsClient');
const svc = require('../services/aircraftSafetyService');

beforeEach(() => {
  jest.clearAllMocks();
  safetyEvents.getByAircraftCodes.mockReturnValue([]);
  sidecar.findAccidentsByFamilyName.mockReturnValue([]);
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
    sidecar.findAccidentsByFamilyName.mockReturnValue([
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

  test('no icaoList → still queries sidecar by family name', () => {
    sidecar.findAccidentsByFamilyName.mockReturnValue([
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
    expect(sidecar.findAccidentsByFamilyName).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });

  test('sidecar throws → silently degrades to safety_events only', () => {
    safetyEvents.getByAircraftCodes.mockReturnValue([
      { id: 1, occurred_at: 1000, fatalities: 0 },
    ]);
    sidecar.findAccidentsByFamilyName.mockImplementation(() => { throw new Error('sidecar down'); });
    const out = svc.getMergedEventsForFamily({ icaoList: ['B789'], familyName: 'Boeing 787' });
    expect(out).toHaveLength(1);
  });

  test('dedup runs across merged sources by (date, operator)', () => {
    const t = Date.parse('2025-06-12T00:00:00Z');
    safetyEvents.getByAircraftCodes.mockReturnValue([
      { id: 10, occurred_at: t, operator_name: 'Air India', fatalities: 0, severity: 'incident' },
    ]);
    sidecar.findAccidentsByFamilyName.mockReturnValue([
      { id: 41900, normalized_date: '2025-06-12', operator: 'Air India', fatalities: '241+19' },
    ]);
    const out = svc.getMergedEventsForFamily({
      icaoList: ['B789'], familyName: 'Boeing 787',
    });
    expect(out).toHaveLength(1);
    expect(out[0].fatalities).toBe(260);    // higher-fatality version kept
  });
});

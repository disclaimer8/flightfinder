'use strict';
const path  = require('path');
const fs    = require('fs');
const {
  mapToSafetyEvent,
  parseVehicleDetails,
  parseLocation,
  parseUSDate,
  severityFromNew,
  fetchEventDetail,
  enrichWithDetail,
  resetDetailCircuitBreaker,
} = require('../services/safety/ntsbAdapter');

const adapter = require('../services/safety/ntsbAdapter');

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/ntsb-sample.json'), 'utf8')
);

describe('parseVehicleDetails', () => {
  test.each([
    ['N12345 : BOEING/737-800', { registration: 'N12345', manufacturer: 'BOEING', model: '737-800' }],
    ['PH-EME : TEXTRON/182T',   { registration: 'PH-EME', manufacturer: 'TEXTRON', model: '182T' }],
    ['N220KK : CESSNA/208',     { registration: 'N220KK', manufacturer: 'CESSNA',  model: '208' }],
    ['N99 : PIPER',             { registration: 'N99',    manufacturer: 'PIPER',   model: null }],
    ['-',                       { registration: null,     manufacturer: null,      model: null }],
    ['',                        { registration: null,     manufacturer: null,      model: null }],
  ])('%s', (input, expected) => {
    expect(parseVehicleDetails(input)).toEqual(expected);
  });
});

describe('parseLocation', () => {
  test.each([
    ['San Francisco, CA',          'USA'],   // US state code
    ['Miami, FL',                  'USA'],
    ['Anchorage, AK',              'USA'],
    ['La Bastide Clairence, FR',   'FR'],   // foreign 2-letter
    ['Tokyo, Japan',               'Japan'],
    ['Unknown',                    null],   // single segment
    ['',                           null],
  ])('%s', (input, expected) => {
    expect(parseLocation(input)).toBe(expected);
  });
});

describe('parseUSDate', () => {
  test('MM/DD/YYYY → epoch ms', () => {
    expect(parseUSDate('04/15/2026')).toBe(Date.parse('2026-04-15T00:00:00Z'));
  });
  test('garbage → null', () => {
    expect(parseUSDate('not-a-date')).toBeNull();
    expect(parseUSDate('')).toBeNull();
    expect(parseUSDate(null)).toBeNull();
  });
});

describe('severityFromNew', () => {
  test('Fatal → fatal', () => {
    expect(severityFromNew({ injuries: 'Fatal', eventType: 'Accident' })).toBe('fatal');
  });
  test('Serious → serious_incident', () => {
    expect(severityFromNew({ injuries: 'Serious', eventType: 'Incident' })).toBe('serious_incident');
  });
  test('Minor → incident', () => {
    expect(severityFromNew({ injuries: 'Minor', eventType: 'Accident' })).toBe('incident');
  });
  test('None + Accident → incident (substantial damage assumed)', () => {
    expect(severityFromNew({ injuries: 'None', eventType: 'Accident' })).toBe('incident');
  });
  test('None + Incident → minor', () => {
    expect(severityFromNew({ injuries: 'None', eventType: 'Incident' })).toBe('minor');
  });
  test('empty → unknown', () => {
    expect(severityFromNew({ injuries: '', eventType: '' })).toBe('unknown');
  });
});

describe('mapToSafetyEvent', () => {
  const NOW = 1735000000000;

  beforeAll(() => {
    // Seed FAA registry so N12345 resolves to Boeing 737-800 (ICAO: B738)
    const faaRegistry = require('../models/faaRegistry');
    faaRegistry.upsertMany([{
      n_number:     'N12345',
      icao24_hex:   null,
      manufacturer: 'BOEING',
      model:        '737-800',
      year_built:   2015,
      owner_name:   'AMERICAN AIRLINES INC',
      updated_at:   Date.now(),
    }]);
  });

  test('Accident with no injuries → incident, US location', () => {
    const r = mapToSafetyEvent(FIXTURE.results[0], NOW);
    expect(r.source).toBe('ntsb');
    expect(r.source_event_id).toBe('WPR26LA101');
    expect(r.severity).toBe('incident');
    expect(r.registration).toBe('N12345');
    expect(r.aircraft_icao_type).toBe('B738');  // resolved via FAA Registry
    expect(r.location_country).toBe('USA');
    expect(r.narrative).toMatch(/gear collapse/);
    expect(r.report_url).toContain('WPR26LA101');
    expect(r.fatalities).toBe(0);
    expect(r.hull_loss).toBe(0);
    expect(r.cictt_category).toBeNull();
    expect(r.phase_of_flight).toBeNull();
    expect(r.location_lat).toBeNull();
    expect(r.location_lon).toBeNull();
  });

  test('Fatal accident → fatal severity, fatalities=1', () => {
    const r = mapToSafetyEvent(FIXTURE.results[1], NOW);
    expect(r.severity).toBe('fatal');
    expect(r.fatalities).toBe(1);
    expect(r.registration).toBe('N98765');
  });

  test('Incident with no injuries → minor', () => {
    const r = mapToSafetyEvent(FIXTURE.results[2], NOW);
    expect(r.severity).toBe('minor');
  });

  test('Fatal accident in Alaska → still USA', () => {
    const r = mapToSafetyEvent(FIXTURE.results[3], NOW);
    expect(r.severity).toBe('fatal');
    expect(r.location_country).toBe('USA');
  });

  test('Serious incident → serious_incident', () => {
    const r = mapToSafetyEvent(FIXTURE.results[4], NOW);
    expect(r.severity).toBe('serious_incident');
    expect(r.injuries).toBe(1);
  });

  test('Minor injuries with docketUrl → uses docketUrl', () => {
    const r = mapToSafetyEvent(FIXTURE.results[5], NOW);
    expect(r.severity).toBe('incident');
    expect(r.report_url).toBe('http://example.com/docket/ERA26LA199');
  });

  test('Foreign event → country code preserved', () => {
    const r = mapToSafetyEvent(FIXTURE.results[6], NOW);
    expect(r.location_country).toBe('FR');
    expect(r.registration).toBe('PH-EME');
    expect(r.aircraft_icao_type).toBeNull(); // PH- not in FAA registry; TEXTRON 182T not in seed
  });

  test('Empty ntsbNumber → null', () => {
    const r = mapToSafetyEvent(FIXTURE.results[7], NOW);
    expect(r).toBeNull();
  });

  test('null/empty input → null (defensive)', () => {
    expect(mapToSafetyEvent(null, NOW)).toBeNull();
    expect(mapToSafetyEvent(undefined, NOW)).toBeNull();
    expect(mapToSafetyEvent({}, NOW)).toBeNull();
  });
});

describe('fetchPage (network — mocked)', () => {
  test('returns rows on 200', async () => {
    jest.resetModules();
    jest.doMock('axios', () => ({
      post: jest.fn().mockResolvedValue({
        status: 200,
        data: { paging: { totalCount: 8 }, results: FIXTURE.results },
      }),
    }));
    const { fetchPage } = require('../services/safety/ntsbAdapter');
    const out = await fetchPage({ sinceDays: 30, page: 0, pageSize: 50 });
    expect(out.rows).toHaveLength(8);
    expect(out.hasMore).toBe(false);
  });

  test('hasMore=true when totalCount > seen', async () => {
    jest.resetModules();
    jest.doMock('axios', () => ({
      post: jest.fn().mockResolvedValue({
        status: 200,
        data: { paging: { totalCount: 200 }, results: new Array(50).fill(FIXTURE.results[0]) },
      }),
    }));
    const { fetchPage } = require('../services/safety/ntsbAdapter');
    const out = await fetchPage({ sinceDays: 30, page: 0, pageSize: 50 });
    expect(out.hasMore).toBe(true);
  });

  test('non-200 → throws with v2 marker', async () => {
    jest.resetModules();
    jest.doMock('axios', () => ({
      post: jest.fn().mockResolvedValue({ status: 503, data: 'Service Unavailable' }),
    }));
    const { fetchPage } = require('../services/safety/ntsbAdapter');
    await expect(fetchPage({ sinceDays: 30, page: 0, pageSize: 50 }))
      .rejects.toThrow(/Carol v2/);
  });
});

describe('enrichWithDetail', () => {
  let originalFlag;
  let testAdapter;

  beforeEach(() => {
    originalFlag = process.env.SAFETY_DETAIL_ENRICHMENT_ENABLED;
    process.env.SAFETY_DETAIL_ENRICHMENT_ENABLED = '1';
    jest.resetModules();
    testAdapter = require('../services/safety/ntsbAdapter');
    testAdapter.resetDetailCircuitBreaker();
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.SAFETY_DETAIL_ENRICHMENT_ENABLED;
    else process.env.SAFETY_DETAIL_ENRICHMENT_ENABLED = originalFlag;
    jest.restoreAllMocks();
  });

  test('returns original event unchanged when feature flag is off', async () => {
    process.env.SAFETY_DETAIL_ENRICHMENT_ENABLED = '0';
    jest.resetModules();
    const freshAdapter = require('../services/safety/ntsbAdapter');
    const event = { source_event_id: 'X', operator_iata: null, cictt_category: null };
    const result = await freshAdapter.enrichWithDetail(event);
    expect(result).toEqual(event);
  });

  test('merges detail fields into event when fetch succeeds', async () => {
    const mockDetail = {
      operator_iata: 'BA',
      operator_icao: 'BAW',
      operator_name: 'British Airways',
      cictt_category: 'F-NI',
      location_lat: null,
      location_lon: null,
      fatalities: null,
      injuries: null,
      hull_loss: null,
    };
    jest.spyOn(testAdapter, 'fetchEventDetail').mockResolvedValue(mockDetail);
    const event = {
      source_event_id: 'X',
      operator_iata: null,
      operator_icao: null,
      operator_name: null,
      cictt_category: null,
      location_lat: null,
      location_lon: null,
      fatalities: 0,
      injuries: 0,
      hull_loss: 0,
    };
    const result = await testAdapter.enrichWithDetail(event);
    expect(result.operator_iata).toBe('BA');
    expect(result.operator_name).toBe('British Airways');
    expect(result.cictt_category).toBe('F-NI');
  });

  test('returns original event when detail fetch throws', async () => {
    jest.spyOn(testAdapter, 'fetchEventDetail').mockRejectedValue(new Error('500'));
    const event = { source_event_id: 'X', operator_iata: null };
    const result = await testAdapter.enrichWithDetail(event);
    expect(result).toEqual(event);
  });

  test('skips remaining fetches after 3 consecutive failures', async () => {
    const fetchSpy = jest.spyOn(testAdapter, 'fetchEventDetail').mockRejectedValue(new Error('500'));
    await testAdapter.enrichWithDetail({ source_event_id: '1' });
    await testAdapter.enrichWithDetail({ source_event_id: '2' });
    await testAdapter.enrichWithDetail({ source_event_id: '3' });
    fetchSpy.mockClear();
    await testAdapter.enrichWithDetail({ source_event_id: '4' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('resetDetailCircuitBreaker clears the failure counter', async () => {
    const fetchSpy = jest.spyOn(testAdapter, 'fetchEventDetail').mockRejectedValue(new Error('500'));
    for (let i = 0; i < 3; i++) {
      await testAdapter.enrichWithDetail({ source_event_id: String(i) });
    }
    testAdapter.resetDetailCircuitBreaker();
    fetchSpy.mockResolvedValueOnce({
      operator_iata: 'BA', operator_icao: null, operator_name: null, cictt_category: null,
      location_lat: null, location_lon: null, fatalities: null, injuries: null, hull_loss: null,
    });
    fetchSpy.mockClear();
    const result = await testAdapter.enrichWithDetail({ source_event_id: 'after-reset', operator_iata: null, location_lat: null, location_lon: null, fatalities: 0, injuries: 0, hull_loss: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.operator_iata).toBe('BA');
  });
});

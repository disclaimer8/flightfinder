'use strict';
const path  = require('path');
const fs    = require('fs');
const { mapToSafetyEvent } = require('../services/safety/ntsbAdapter');

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/ntsb-sample.json'), 'utf8')
);

describe('mapToSafetyEvent', () => {
  const NOW = 1735000000000;

  test('runway excursion → incident, RE, KLAX→KSFO', () => {
    const r = mapToSafetyEvent(FIXTURE.ResultList[0], NOW);
    expect(r.source).toBe('ntsb');
    expect(r.source_event_id).toBe('WPR24LA101');
    expect(r.severity).toBe('incident');
    expect(r.cictt_category).toBe('RE');
    expect(r.phase_of_flight).toBe('LDG');
    expect(r.dep_iata).toBe('LAX');
    expect(r.arr_iata).toBe('SFO');
    expect(r.operator_icao).toBe('AAL');
    expect(r.operator_name).toBe('American Airlines');
    expect(r.aircraft_icao_type).toBeNull();
    expect(r.registration).toBe('N12345');
    expect(r.location_lat).toBeCloseTo(37.6189);
    expect(r.location_lon).toBeCloseTo(-122.3750);
    expect(r.fatalities).toBe(0);
    expect(r.hull_loss).toBe(0);
    expect(r.ingested_at).toBe(NOW);
    expect(r.updated_at).toBe(NOW);
    expect(r.report_url).toContain('WPR24LA101');
  });

  test('LOC-I + Destroyed + 4 fatalities → fatal, hull_loss=1', () => {
    const r = mapToSafetyEvent(FIXTURE.ResultList[1], NOW);
    expect(r.severity).toBe('fatal');
    expect(r.fatalities).toBe(4);
    expect(r.hull_loss).toBe(1);
    expect(r.cictt_category).toBe('LOC-I');
  });

  test('Bird strike, minor damage → minor', () => {
    const r = mapToSafetyEvent(FIXTURE.ResultList[2], NOW);
    expect(r.severity).toBe('minor');
    expect(r.cictt_category).toBe('BIRD');
  });

  test('CFIT fatal → fatal + hull_loss', () => {
    const r = mapToSafetyEvent(FIXTURE.ResultList[3], NOW);
    expect(r.severity).toBe('fatal');
    expect(r.cictt_category).toBe('CFIT');
    expect(r.hull_loss).toBe(1);
  });

  test('Turbulence with 3 serious + 7 minor → serious_incident', () => {
    const r = mapToSafetyEvent(FIXTURE.ResultList[4], NOW);
    expect(r.severity).toBe('serious_incident');
    expect(r.cictt_category).toBe('TURB');
    expect(r.injuries).toBe(10);
  });

  test('Powerplant failure with Cape Air operator IATA mapped', () => {
    const r = mapToSafetyEvent(FIXTURE.ResultList[5], NOW);
    expect(r.cictt_category).toBe('SCF-PP');
    expect(r.operator_iata).toBe('9K');
    expect(r.operator_icao).toBe('KAP');
  });

  test('Fuel exhaustion → FUEL, incident', () => {
    const r = mapToSafetyEvent(FIXTURE.ResultList[6], NOW);
    expect(r.cictt_category).toBe('FUEL');
    expect(r.severity).toBe('incident');
  });

  test('Empty/missing fields → unknown severity, OTHR category, no crash', () => {
    const r = mapToSafetyEvent(FIXTURE.ResultList[7], NOW);
    expect(r.severity).toBe('unknown');
    expect(r.cictt_category).toBe('OTHR');
    expect(r.phase_of_flight).toBe('UNK');
    expect(r.operator_name).toBeNull();
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
      post: jest.fn().mockResolvedValue({ status: 200, data: FIXTURE }),
    }));
    const { fetchPage } = require('../services/safety/ntsbAdapter');
    const out = await fetchPage({ sinceDays: 30, page: 0, pageSize: 50 });
    expect(out.rows).toHaveLength(8);
    expect(out.hasMore).toBe(false);
  });

  test('hasMore=true when page is full', async () => {
    jest.resetModules();
    const fullPage = { ResultListCount: 50, ResultList: new Array(50).fill(FIXTURE.ResultList[0]) };
    jest.doMock('axios', () => ({
      post: jest.fn().mockResolvedValue({ status: 200, data: fullPage }),
    }));
    const { fetchPage } = require('../services/safety/ntsbAdapter');
    const out = await fetchPage({ sinceDays: 30, page: 0, pageSize: 50 });
    expect(out.hasMore).toBe(true);
  });

  test('non-200 → throws', async () => {
    jest.resetModules();
    jest.doMock('axios', () => ({
      post: jest.fn().mockResolvedValue({ status: 503, data: 'Service Unavailable' }),
    }));
    const { fetchPage } = require('../services/safety/ntsbAdapter');
    await expect(fetchPage({ sinceDays: 30, page: 0, pageSize: 50 }))
      .rejects.toThrow(/NTSB CAROL/);
  });
});

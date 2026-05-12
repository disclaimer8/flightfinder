'use strict';
const request = require('supertest');
const { db } = require('../models/db');
const model  = require('../models/accidentNarratives');

jest.mock('../services/sidecarAccidentsClient', () => ({
  getAccidentById: jest.fn(),
  getAccidentIdBySourceEventId: jest.fn(),
  findRelatedByAircraft: jest.fn(() => []),
  findRelatedByOperator: jest.fn(() => []),
}));
const sidecar = require('../services/sidecarAccidentsClient');
const app = require('../index');

const NOW = 1715500000;

beforeEach(() => {
  db.exec(`DELETE FROM accident_narratives`);
  jest.clearAllMocks();
});

function insertNarrative({ slug, accident_id = 1, score = 100 }) {
  model.upsert({
    accident_id, source: 'ntsb', source_event_id: `E${accident_id}`,
    source_url: `https://carol.ntsb.gov/event/E${accident_id}`,
    slug, narrative_text: score >= 30 ? 'x'.repeat(400) : null,
    probable_cause: score >= 50 ? 'y'.repeat(150) : null,
    factors_json: score >= 70 ? '["A"]' : null,
    phase_of_flight: score >= 60 ? 'CRUISE' : null,
    weather_summary: score >= 60 ? 'VMC' : null,
    fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
  });
}

describe('GET /api/accidents/:slug', () => {
  it('200 with merged data when quality_score >= 50', async () => {
    insertNarrative({ slug: 'high', accident_id: 1, score: 100 });
    sidecar.getAccidentById.mockReturnValue({
      id: 1, aircraft_model: 'BEECH F33A', operator: 'Private',
      fatalities: '2', location: 'MN', date: '25 Apr 2026',
    });
    const res = await request(app).get('/api/accidents/high');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('high');
    expect(res.body.facts.aircraft_model).toBe('BEECH F33A');
  });

  it('404 when slug unknown', async () => {
    const res = await request(app).get('/api/accidents/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('410 + Location header when quality_score < 30', async () => {
    insertNarrative({ slug: 'low', accident_id: 7, score: 0 });
    sidecar.getAccidentById.mockReturnValue({
      id: 7, aircraft_model: 'X', operator: 'Y', fatalities: '0',
      location: 'Z', date: 'today',
    });
    const res = await request(app).get('/api/accidents/low');
    expect(res.status).toBe(410);
    expect(res.headers.location).toBe('/safety/global');
  });

  it('200 with noindex marker when 30 <= score < 50', async () => {
    insertNarrative({ slug: 'mid', accident_id: 5, score: 30 });
    sidecar.getAccidentById.mockReturnValue({
      id: 5, aircraft_model: 'X', operator: 'Y', fatalities: '0',
      location: 'Z', date: 'today',
    });
    const res = await request(app).get('/api/accidents/mid');
    expect(res.status).toBe(200);
    expect(res.body.indexable).toBe(0);
    expect(res.body.noindex).toBe(true);
  });
});

describe('GET /api/accidents', () => {
  it('returns paginated indexable list', async () => {
    insertNarrative({ slug: 'a', accident_id: 1, score: 100 });
    insertNarrative({ slug: 'b', accident_id: 2, score: 0 });
    const res = await request(app).get('/api/accidents?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('a');
  });
});

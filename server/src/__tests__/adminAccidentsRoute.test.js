'use strict';
const request = require('supertest');
const { db } = require('../models/db');
const model  = require('../models/accidentNarratives');
const app    = require('../index');

const NOW = 1715500000;

beforeAll(() => {
  process.env.ADMIN_TOKEN = 'test-token';
});

afterAll(() => {
  delete process.env.ADMIN_TOKEN;
});

beforeEach(() => {
  db.exec(`DELETE FROM accident_narratives`);
});

describe('GET /api/admin/accident-narratives-stats', () => {
  it('returns score distribution and source counts', async () => {
    model.upsert({
      accident_id: 1, source: 'ntsb', source_event_id: 'a',
      source_url: 'http://x', slug: 'hi',
      narrative_text: 'x'.repeat(400), probable_cause: 'y'.repeat(150),
      factors_json: '["a"]', phase_of_flight: 'CRUISE', weather_summary: 'VMC',
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    model.upsert({
      accident_id: 2, source: 'wikidata', source_event_id: 'Q1',
      source_url: 'http://x', slug: 'lo',
      narrative_text: null, probable_cause: null, factors_json: null,
      phase_of_flight: null, weather_summary: null,
      fetched_at: NOW, ingested_at: NOW, updated_at: NOW,
    });
    const res = await request(app)
      .get('/api/admin/accident-narratives-stats')
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.indexable).toBe(1);
    expect(res.body.score_distribution['90-100']).toBe(1);
    expect(res.body.by_source.ntsb).toBe(1);
    expect(res.body.by_source.wikidata).toBe(1);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/admin/accident-narratives-stats');
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization token is wrong', async () => {
    const res = await request(app)
      .get('/api/admin/accident-narratives-stats')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });
});

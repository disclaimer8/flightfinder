'use strict';

const request = require('supertest');

describe('/api/safety/* HTTP', () => {
  let app, safety;

  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-32-chars--xx';
    app    = require('../index');
    safety = require('../models/safetyEvents');

    const now = Date.now();
    safety.upsertEvent({
      source:'ntsb', source_event_id:'A-1', occurred_at: now - 86400000,
      severity:'fatal', fatalities:3, injuries:0, hull_loss:1,
      cictt_category:'LOC-I', phase_of_flight:'CRZ',
      operator_iata:null, operator_icao:'AAL', operator_name:'American',
      aircraft_icao_type:null, registration:'N111AA', dep_iata:'LAX', arr_iata:'JFK',
      location_country:'USA', location_lat:null, location_lon:null,
      narrative:'narrative', report_url:'http://x', ingested_at:now, updated_at:now,
    });
    safety.upsertEvent({
      source:'ntsb', source_event_id:'B-1', occurred_at: now - 172800000,
      severity:'incident', fatalities:0, injuries:1, hull_loss:0,
      cictt_category:'RE', phase_of_flight:'LDG',
      operator_iata:null, operator_icao:'AAL', operator_name:'American',
      aircraft_icao_type:null, registration:'N222AA', dep_iata:'JFK', arr_iata:'LAX',
      location_country:'USA', location_lat:null, location_lon:null,
      narrative:null, report_url:'http://x', ingested_at:now, updated_at:now,
    });
    safety.upsertEvent({
      source:'ntsb', source_event_id:'C-1', occurred_at: now - 259200000,
      severity:'minor', fatalities:0, injuries:0, hull_loss:0,
      cictt_category:'BIRD', phase_of_flight:'TOF',
      operator_iata:'9K', operator_icao:'KAP', operator_name:'Cape Air',
      aircraft_icao_type:null, registration:'N333KK', dep_iata:'BOS', arr_iata:'HYA',
      location_country:'USA', location_lat:null, location_lon:null,
      narrative:null, report_url:'http://x', ingested_at:now, updated_at:now,
    });
  });

  test('GET /api/safety/events returns shaped list', async () => {
    const r = await request(app).get('/api/safety/events?limit=10');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.length).toBeGreaterThanOrEqual(3);
    const fatal = r.body.data.find(e => e.severity === 'fatal');
    expect(fatal.severityLabel).toBe('Fatal accident');
    expect(fatal.cicttLabel).toBe('Loss of control in flight');
    expect(fatal.operator.icao).toBe('AAL');
    expect(fatal.hullLoss).toBe(true);
  });

  test('GET /api/safety/events?severity=fatal filters', async () => {
    const r = await request(app).get('/api/safety/events?severity=fatal');
    expect(r.status).toBe(200);
    for (const e of r.body.data) expect(e.severity).toBe('fatal');
  });

  test('GET /api/safety/events?severity=BOGUS → 400', async () => {
    const r = await request(app).get('/api/safety/events?severity=BOGUS');
    expect(r.status).toBe(400);
  });

  test('GET /api/safety/events/:id returns one', async () => {
    const list = await request(app).get('/api/safety/events?limit=1');
    const id   = list.body.data[0].id;
    const r    = await request(app).get(`/api/safety/events/${id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(id);
  });

  test('GET /api/safety/events/999999 → 404', async () => {
    const r = await request(app).get('/api/safety/events/999999');
    expect(r.status).toBe(404);
  });

  test('GET /api/safety/operators/AAL → free 90d count + upgrade block', async () => {
    const r = await request(app).get('/api/safety/operators/AAL');
    expect(r.status).toBe(200);
    expect(r.body.counts.fatal).toBe(1);
    expect(r.body.counts.incident).toBe(1);
    expect(r.body.upgrade).toBeDefined();
    expect(r.body.proStats).toBeUndefined();
  });

  test('GET /api/safety/operators/AAL with invalid token → still returns free tier', async () => {
    const r = await request(app)
      .get('/api/safety/operators/AAL')
      .set('Authorization', 'Bearer not-a-real-token-xyz');
    expect(r.status).toBe(200);
    expect(r.body.counts.fatal).toBe(1);
    expect(r.body.upgrade).toBeDefined();
    expect(r.body.proStats).toBeUndefined();
  });

  test('GET /api/safety/operators/9K (IATA) recognized', async () => {
    const r = await request(app).get('/api/safety/operators/9K');
    expect(r.status).toBe(200);
    expect(r.body.counts.minor).toBe(1);
  });

  test('GET /api/safety/operators/Z (bad code) → 400', async () => {
    const r = await request(app).get('/api/safety/operators/Z');
    expect(r.status).toBe(400);
  });

  test('GET /api/safety/aircraft/N111AA → 401 without auth', async () => {
    const r = await request(app).get('/api/safety/aircraft/N111AA');
    expect(r.status).toBe(401);
  });
});

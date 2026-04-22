// CRITICAL privacy test: user A's trip must not leak to user B even on
// direct-id or list requests. Mocks only the auth middleware so the
// controller + model + DB stack runs real end-to-end.

const express = require('express');
const request = require('supertest');

const { db } = require('../models/db');
const tripsModel = require('../models/trips');
const controller = require('../controllers/tripsController');

function fakeAuth(req, _res, next) {
  const id = Number(req.headers['x-user-id']);
  req.user = { id, subscription_tier: 'pro_lifetime', sub_valid_until: null };
  next();
}

function app() {
  const a = express();
  a.use(express.json());
  a.use(fakeAuth);
  a.get('/trips',        controller.list);
  a.post('/trips',       controller.create);
  a.get('/trips/:id',    controller.get);
  a.delete('/trips/:id', controller.remove);
  return a;
}

let userA, userB, tripA;

beforeAll(() => {
  db.exec("DELETE FROM user_trips");
  db.exec("DELETE FROM users WHERE email LIKE '%.ownership@test'");
  const now = Date.now();
  userA = db.prepare(
    "INSERT INTO users (email, password_hash, created_at, updated_at, email_verified) VALUES ('a.ownership@test','x',?,?,1)"
  ).run(now, now).lastInsertRowid;
  userB = db.prepare(
    "INSERT INTO users (email, password_hash, created_at, updated_at, email_verified) VALUES ('b.ownership@test','x',?,?,1)"
  ).run(now, now).lastInsertRowid;
  tripA = tripsModel.create({
    user_id: userA, airline_iata: 'BA', flight_number: '175',
    dep_iata: 'LHR', arr_iata: 'JFK',
    scheduled_dep: now + 86400000, scheduled_arr: now + 86400000 + 7 * 3600000,
  });
});

describe('trip ownership', () => {
  test('user B cannot GET user A trip', async () => {
    const res = await request(app()).get(`/trips/${tripA}`).set('x-user-id', String(userB));
    expect(res.status).toBe(404);
  });

  test('user B cannot DELETE user A trip', async () => {
    const res = await request(app()).delete(`/trips/${tripA}`).set('x-user-id', String(userB));
    expect(res.status).toBe(404);
    const still = tripsModel.getOwned(tripA, userA);
    expect(still).toBeTruthy(); // unchanged
  });

  test("user B's /trips list does NOT contain user A trip", async () => {
    const res = await request(app()).get('/trips').set('x-user-id', String(userB));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('user A can GET + DELETE their own trip', async () => {
    const g = await request(app()).get(`/trips/${tripA}`).set('x-user-id', String(userA));
    expect(g.status).toBe(200);
    expect(g.body.data.flight_number).toBe('175');
    const d = await request(app()).delete(`/trips/${tripA}`).set('x-user-id', String(userA));
    expect(d.status).toBe(200);
  });
});

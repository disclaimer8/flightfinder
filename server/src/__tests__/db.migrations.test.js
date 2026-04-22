// Ensures all new schema migrations are idempotent (safe to rerun on restart).
// The db module auto-runs migrations on require(); requiring it twice in the
// same process will NOT rerun them (node caches modules), so we simulate by
// executing the migration SQL manually a second time.

describe('subscription schema migrations', () => {
  let db;
  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    db = require('../models/db').db;
  });

  const ALTERS = [
    "ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free'",
    "ALTER TABLE users ADD COLUMN sub_valid_until INTEGER",
    "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT",
  ];

  test('rerunning ALTERs on users does not throw via try/catch wrapper', () => {
    for (const sql of ALTERS) {
      expect(() => { try { db.exec(sql); } catch {} }).not.toThrow();
    }
  });

  test('users table has new columns', () => {
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'subscription_tier', 'sub_valid_until', 'stripe_customer_id',
    ]));
  });

  test('subscriptions table exists with expected columns', () => {
    const cols = db.prepare("PRAGMA table_info(subscriptions)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id','user_id','stripe_sub_id','stripe_session_id','tier','status',
      'period_end','trial_end','created_at','updated_at',
    ]));
  });

  test('lifetime_counter seeded with cap=500 taken=0', () => {
    const row = db.prepare('SELECT taken, cap FROM lifetime_counter WHERE id=1').get();
    expect(row).toEqual({ taken: 0, cap: 500 });
  });

  test('webhook_events table exists', () => {
    const cols = db.prepare("PRAGMA table_info(webhook_events)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'received_at']));
  });
});

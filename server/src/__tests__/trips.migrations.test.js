describe('trips + push migrations', () => {
  let db;
  beforeAll(() => { jest.resetModules(); process.env.NODE_ENV = 'test'; db = require('../models/db').db; });

  test('user_trips columns', () => {
    const cols = db.prepare("PRAGMA table_info(user_trips)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id','user_id','airline_iata','flight_number','dep_iata','arr_iata',
      'scheduled_dep','scheduled_arr','note','alerts_enabled','created_at',
    ]));
  });

  test('push_tokens columns', () => {
    const cols = db.prepare("PRAGMA table_info(push_tokens)").all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['id','user_id','endpoint','p256dh','auth','created_at']));
  });
});

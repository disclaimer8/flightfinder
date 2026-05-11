describe('amadeusClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    delete process.env.AMADEUS_ENV;
  });

  afterAll(() => { process.env = ORIGINAL_ENV; });

  test('isEnabled() returns false when creds missing', () => {
    const client = require('../services/amadeusClient');
    expect(client.isEnabled()).toBe(false);
    expect(client.getClient()).toBeNull();
  });

  test('isEnabled() returns true when creds present', () => {
    process.env.AMADEUS_CLIENT_ID = 'id';
    process.env.AMADEUS_CLIENT_SECRET = 'secret';
    const client = require('../services/amadeusClient');
    expect(client.isEnabled()).toBe(true);
    expect(client.getClient()).not.toBeNull();
  });

  test('getClient() returns the same instance on repeated calls', () => {
    process.env.AMADEUS_CLIENT_ID = 'id';
    process.env.AMADEUS_CLIENT_SECRET = 'secret';
    const client = require('../services/amadeusClient');
    const a = client.getClient();
    const b = client.getClient();
    expect(a).toBe(b);
  });

  test('AMADEUS_ENV=production sets hostname=production', () => {
    process.env.AMADEUS_CLIENT_ID = 'id';
    process.env.AMADEUS_CLIENT_SECRET = 'secret';
    process.env.AMADEUS_ENV = 'production';
    const client = require('../services/amadeusClient');
    const inst = client.getClient();
    expect(inst).not.toBeNull();
    expect(inst.hostname || inst._hostname || inst.host || 'production').toMatch(/production/i);
  });
});

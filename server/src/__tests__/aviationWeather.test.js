// server/src/__tests__/aviationWeather.test.js
const aviationWeather = require('../services/aviationWeatherService');

describe('aviationWeatherService', () => {
  const savedFetch = global.fetch;
  afterEach(() => { global.fetch = savedFetch; aviationWeather._clearCache(); });

  test('parses a METAR JSON array into the openWeather-compatible shape', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ([{
        icaoId: 'EGLL',
        temp: 18.5,
        wspd: 7,
        wxString: 'Clouds',
        rawOb: 'EGLL 201150Z 25007KT 10SM FEW040 18/09 Q1015',
        obsTime: 1_700_000_000,
      }]),
    });
    const out = await aviationWeather.fetch({ icao: 'EGLL' });
    expect(out).toEqual(expect.objectContaining({
      tempC: 19,           // Math.round(18.5)
      windMps: expect.any(Number),
      condition: 'Clouds',
      description: expect.stringMatching(/^EGLL/),
      observedAt: 1_700_000_000 * 1000,
    }));
  });

  test('returns null when NOAA returns non-ok', async () => {
    global.fetch = async () => ({ ok: false, status: 503 });
    expect(await aviationWeather.fetch({ icao: 'EGLL' })).toBeNull();
  });

  test('caches within TTL so a second call makes no fetch', async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return { ok: true, json: async () => ([{ icaoId: 'EGLL', temp: 1, obsTime: 1 }]) };
    };
    await aviationWeather.fetch({ icao: 'EGLL' });
    await aviationWeather.fetch({ icao: 'EGLL' });
    expect(calls).toBe(1);
  });
});

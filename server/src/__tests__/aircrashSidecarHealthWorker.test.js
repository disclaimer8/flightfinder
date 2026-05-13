jest.mock('axios');
jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}), { virtual: false });

const axios = require('axios');
const Sentry = require('@sentry/node');
const worker = require('../workers/aircrashSidecarHealthWorker');

describe('aircrashSidecarHealthWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does NOT capture on 200 responses', async () => {
    axios.get.mockResolvedValue({ status: 200, data: [{ name: 'B738', count: 1 }] });
    await worker._internal.probeOnce('/stats/aircrafts?commercial=1');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('captures to Sentry on 500 with route + status tags + stable fingerprint', async () => {
    axios.get.mockResolvedValue({ status: 500, data: { error: 'internal' } });
    await worker._internal.probeOnce('/stats/aircrafts?commercial=1');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, opts] = Sentry.captureMessage.mock.calls[0];
    expect(message).toBe('aircrash-sidecar 5xx');
    expect(opts.level).toBe('error');
    expect(opts.tags).toMatchObject({
      component: 'aircrash-sidecar',
      probe: '/stats/aircrafts?commercial=1',
      status: '500',
    });
    expect(opts.fingerprint).toEqual([
      'aircrash-sidecar',
      '/stats/aircrafts?commercial=1',
      '500',
    ]);
    expect(opts.contexts.sidecar.status).toBe(500);
  });

  it('captures any 5xx (502, 503) — not just 500', async () => {
    axios.get.mockResolvedValueOnce({ status: 502, data: 'bad gateway' });
    await worker._internal.probeOnce('/stats/operators?commercial=1');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage.mock.calls[0][1].tags.status).toBe('502');
  });

  it('does NOT capture on network errors (ECONNREFUSED, timeouts)', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    await worker._internal.probeOnce('/stats/aircrafts?commercial=1');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('does NOT capture on 4xx (sidecar said no, but no internal error)', async () => {
    axios.get.mockResolvedValue({ status: 404, data: { error: 'not found' } });
    await worker._internal.probeOnce('/stats/aircrafts?commercial=1');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('runCycle probes both endpoints in order', async () => {
    axios.get.mockResolvedValue({ status: 200, data: [] });
    await worker._internal.runCycle();
    expect(axios.get).toHaveBeenCalledTimes(2);
    const urls = axios.get.mock.calls.map(c => c[0]);
    expect(urls).toEqual([
      'http://127.0.0.1:5003/stats/aircrafts?commercial=1',
      'http://127.0.0.1:5003/stats/operators?commercial=1',
    ]);
  });

  it('passes 5s timeout and validateStatus that lets all statuses through', async () => {
    axios.get.mockResolvedValue({ status: 200, data: [] });
    await worker._internal.probeOnce('/stats/aircrafts?commercial=1');
    const opts = axios.get.mock.calls[0][1];
    expect(opts.timeout).toBe(5000);
    expect(typeof opts.validateStatus).toBe('function');
    expect(opts.validateStatus(500)).toBe(true);
    expect(opts.validateStatus(200)).toBe(true);
  });

  it('startAircrashSidecarHealthWorker() returns a no-op stop function in NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test');
    const stop = worker.startAircrashSidecarHealthWorker();
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});

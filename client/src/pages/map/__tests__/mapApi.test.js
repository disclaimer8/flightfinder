import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch to capture URLs
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

import { fetchRouteBrief } from '../mapApi';

describe('fetchRouteBrief — server contract', () => {
  it('builds URL with dep= and arr= (NOT from= and to=)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    await fetchRouteBrief({ from: 'LHR', to: 'JFK' });
    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[0][0];
    expect(url).toMatch(/dep=LHR/);
    expect(url).toMatch(/arr=JFK/);
    expect(url).not.toMatch(/from=/);
    expect(url).not.toMatch(/to=/);
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(fetchRouteBrief({ from: 'LHR', to: 'JFK' })).rejects.toThrow(/400/);
  });
});

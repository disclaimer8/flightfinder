'use strict';

// Drift guard: server/src/content/aircraftLandingContent.json and
// client/src/data/aircraftLandingContent.json must stay byte-identical
// — they're consumed in parallel by SSR (bAircraft) and CSR (AircraftLandingPage).
// If they diverge, search engines see one thing and humans see another.
// Single trivial assertion; high-value catch in CI.

const path = require('path');
const fs = require('fs');

describe('aircraftLandingContent server/client parity', () => {
  test('server and client copies are byte-identical', () => {
    const serverPath = path.join(__dirname, '..', 'content', 'aircraftLandingContent.json');
    const clientPath = path.join(__dirname, '..', '..', '..', 'client', 'src', 'data', 'aircraftLandingContent.json');
    const server = fs.readFileSync(serverPath, 'utf8');
    const client = fs.readFileSync(clientPath, 'utf8');
    expect(client).toEqual(server);
  });
});

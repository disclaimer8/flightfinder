'use strict';
const { aircraftPlaceholder } = require('../services/seoAircraftPlaceholder');

describe('aircraftPlaceholder', () => {
  it('renders informative placeholder linking to /by-aircraft', () => {
    const html = aircraftPlaceholder();
    expect(html).toContain('Aircraft assignments');
    expect(html).toContain('/by-aircraft');
    expect(html).toMatch(/coming|expanding/i);
    expect(html).not.toMatch(/Boeing 737|Airbus A320/);
  });
});

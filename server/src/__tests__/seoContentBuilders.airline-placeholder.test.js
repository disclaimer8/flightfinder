const fs = require('fs');
const path = require('path');

describe('bAirline does not emit "Network data is being collected"', () => {
  test('builder source has no "being collected" placeholder', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'seoContentBuilders.js'),
      'utf8'
    );
    expect(src).not.toMatch(/Network data is being collected/);
  });
});

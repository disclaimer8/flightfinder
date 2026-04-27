const fs = require('fs');
const path = require('path');

describe('ita-matrix-response.json fixture', () => {
  test('inner_json matches the JSON embedded in raw_multipart_envelope', () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'fixtures', 'ita-matrix-response.json'),
        'utf8'
      )
    );
    const env = fixture.raw_multipart_envelope;
    const start = env.indexOf('{');
    const end = env.lastIndexOf('}');
    if (start < 0 || end < 0) throw new Error('no JSON in envelope');
    const extracted = JSON.parse(env.slice(start, end + 1));
    expect(extracted).toEqual(fixture.inner_json);
  });
});

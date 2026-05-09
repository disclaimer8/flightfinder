// server/src/__tests__/seoMetaService.inject.test.js
const { inject } = require('../services/seoMetaService');

const META = {
  title: 'T', description: 'D', canonical: 'https://himaxym.com/x',
  h1: 'H1', subtitle: 'SUB', kind: 'home',
};

const HTML = `<!doctype html><html><head>
<title>old</title>
<meta name="description" content="old" />
<link rel="canonical" href="old" />
<meta property="og:url" content="old" />
<meta property="og:title" content="old" />
<meta property="og:description" content="old" />
<meta name="twitter:title" content="old" />
<meta name="twitter:description" content="old" />
</head><body><div id="root">
<h1 style="font-size:clamp(32px,6vw,56px)">old h1</h1>
<p style="font-size:clamp(16px,2.2vw,20px)">old subtitle</p>
</div></body></html>`;

describe('inject() bodyContent argument', () => {
  it('is byte-equivalent to two-arg form when bodyContent is null', () => {
    expect(inject(HTML, META, null)).toBe(inject(HTML, META));
  });

  it('inserts a data-seo-bake section inside #root when bodyContent given', () => {
    const out = inject(HTML, META, '<p>baked fact one</p><p>baked fact two</p>');
    expect(out).toMatch(/<section data-seo-bake="true">/);
    expect(out).toMatch(/baked fact one/);
    expect(out).toMatch(/baked fact two/);
    // Section lives inside #root
    const rootStart = out.indexOf('<div id="root">');
    const rootEnd   = out.indexOf('</div>', rootStart);
    const sectionAt = out.indexOf('<section data-seo-bake');
    expect(sectionAt).toBeGreaterThan(rootStart);
    expect(sectionAt).toBeLessThan(rootEnd);
  });

  it('still swaps H1 and subtitle when bodyContent is provided', () => {
    const out = inject(HTML, META, '<p>extra</p>');
    expect(out).toMatch(/>H1</);
    expect(out).toMatch(/>SUB</);
  });

  it('does not double-insert if called twice', () => {
    const once  = inject(HTML, META, '<p>x</p>');
    const twice = inject(once, META, '<p>x</p>');
    expect((twice.match(/data-seo-bake/g) || []).length).toBe(1);
  });

  it('does not throw and omits the section when subtitle marker is absent', () => {
    const stripped = HTML.replace(/<p style="font-size:clamp\(16px[^"]*">[^<]*<\/p>/, '');
    // Suppress expected warn output in test logs.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = inject(stripped, META, '<p>baked fact</p>');
    expect(out).not.toMatch(/data-seo-bake/);
    expect(out).toMatch(/>H1</);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('subtitle anchor missing')
    );
    warnSpy.mockRestore();
  });
});

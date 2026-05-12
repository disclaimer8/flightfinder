'use strict';

// Dynamic OG image generator for /accidents/:slug pages. Builds a 1200×630
// SVG per accident (aircraft model + date + operator + severity color band)
// and renders to PNG via @resvg/resvg-js (WASM, no native deps).
//
// Each PNG is keyed by slug and immutable per snapshot, so cache-control
// pushes the work to Cloudflare's edge — we only run the SVG render on
// first hit per slug per CF data center.

const svc = require('./accidentNarrativeService');

// Lazy-require @resvg so unit tests that don't exercise OG generation
// don't pay the WASM load cost. The module footprint is ~3 MB.
let _Resvg = null;
function getResvg() {
  if (_Resvg) return _Resvg;
  _Resvg = require('@resvg/resvg-js').Resvg;
  return _Resvg;
}

// Per-family background colors. Detected via substring match on
// f.aircraft_model. Keep the palette muted so the severity band on top
// (red / green / gray) reads as the primary signal.
const FAMILY_COLORS = {
  boeing:     '#1F3A93',
  airbus:     '#37588F',
  embraer:    '#005B95',
  bombardier: '#6B4E2E',
  atr:        '#7A2A2A',
  cessna:     '#5C4628',
  piper:      '#5C4628',
  beechcraft: '#5C4628',
  generic:    '#1F2937',
};

function detectFamily(model) {
  if (!model) return 'generic';
  const m = String(model).toUpperCase();
  if (m.includes('BOEING') || /\bB[1-9]\d{2}\b/.test(m)) return 'boeing';
  if (m.includes('AIRBUS') || /\bA[1-9]\d{2}\b/.test(m)) return 'airbus';
  if (m.includes('EMBRAER') || /\bE[1-2]\d{2}\b/.test(m)) return 'embraer';
  if (m.includes('BOMBARDIER') || m.includes('CRJ') || m.includes('DASH')) return 'bombardier';
  if (m.includes('ATR'))        return 'atr';
  if (m.includes('CESSNA'))     return 'cessna';
  if (m.includes('PIPER'))      return 'piper';
  if (m.includes('BEECH'))      return 'beechcraft';
  return 'generic';
}

function severityBand(fatalities) {
  const n = String(fatalities ?? '').split('+').reduce((a, b) => a + (Number(b) || 0), 0);
  if (n > 0) return { color: '#C0392B', label: `${n} ${n === 1 ? 'FATALITY' : 'FATALITIES'}` };
  if (fatalities === '0') return { color: '#1E8449', label: 'NO FATALITIES' };
  return { color: '#5D6D7E', label: 'CASUALTIES UNKNOWN' };
}

function escSvg(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSvg(data) {
  const f = data.facts || {};
  const family = detectFamily(f.aircraft_model);
  const bg     = FAMILY_COLORS[family];
  const sev    = severityBand(f.fatalities);
  const aircraft  = (f.aircraft_model || 'Aircraft').slice(0, 40);
  const date      = f.date || 'Unknown date';
  const operator  = (f.operator || '').slice(0, 50);
  const location  = (f.location || '').slice(0, 60);
  const reg       = f.registration ? `  (${f.registration})` : '';

  // System-font fallback list — @resvg loads DejaVu Sans on Ubuntu, which
  // covers all printable ASCII plus most diacritics in NTSB data.
  const FF = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${bg}"/>
  <rect x="0" y="0" width="1200" height="70" fill="${sev.color}"/>
  <text x="60" y="48" font-family='${FF}' font-size="28" font-weight="700" fill="white" letter-spacing="3">${escSvg(sev.label)}</text>
  <text x="60" y="260" font-family='${FF}' font-size="68" font-weight="800" fill="white" letter-spacing="-1">${escSvg(aircraft + reg)}</text>
  <text x="60" y="335" font-family='${FF}' font-size="34" fill="rgba(255,255,255,0.85)">${escSvg(date)}${operator ? '  ·  ' + escSvg(operator) : ''}</text>
  ${location ? `<text x="60" y="385" font-family='${FF}' font-size="28" fill="rgba(255,255,255,0.65)">${escSvg(location)}</text>` : ''}
  <text x="60" y="570" font-family='${FF}' font-size="24" font-weight="600" fill="white" opacity="0.7">FlightFinder · aviation safety database</text>
  <text x="60" y="600" font-family='${FF}' font-size="18" fill="white" opacity="0.5">Sourced from NTSB CAROL · public domain</text>
</svg>`;
}

async function buildOgImagePng(slug) {
  const data = svc.getBySlug(slug);
  if (!data || data.indexable !== 1) return null;
  const svg = buildSvg(data);
  const Resvg = getResvg();
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  });
  return r.render().asPng();
}

module.exports = {
  buildOgImagePng,
  detectFamily,
  severityBand,
  buildSvg,    // export for tests
};

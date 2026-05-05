#!/usr/bin/env node
/**
 * Generates client/public/content/aircraft-index.json by joining:
 *   - server/src/models/aircraftFamilies.js (family metadata)
 *   - client/public/content/landing/aircraft/<slug>.json (per-family copy)
 *
 * Output entry shape:
 *   { slug, label, manufacturer, category, tagline }
 *
 * Runs as a `prebuild` hook in client/package.json so the JSON is fresh
 * on every Vite production build.
 */

const fs   = require('fs');
const path = require('path');

const REPO_ROOT      = path.join(__dirname, '..');
const FAMILIES_FILE  = path.join(REPO_ROOT, 'server', 'src', 'models', 'aircraftFamilies.js');
const LANDING_DIR    = path.join(REPO_ROOT, 'client', 'public', 'content', 'landing', 'aircraft');
const OUTPUT_FILE    = path.join(REPO_ROOT, 'client', 'public', 'content', 'aircraft-index.json');

// Map server-side type to UI category
const CATEGORY_MAP = {
  'wide-body': 'wide-body',
  'jet':       'narrow-body',
  'regional':  'regional',
  'turboprop': 'turboprop',
};

function loadFamilies() {
  const mod = require(FAMILIES_FILE);
  if (typeof mod.getFamilyList === 'function') return mod.getFamilyList();
  if (mod.families) {
    return Object.entries(mod.families).map(([name, meta]) => ({
      slug: meta.slug ?? name.toLowerCase().replace(/\s+/g, '-'),
      label: meta.label ?? name,
      manufacturer: meta.manufacturer,
      type: meta.type,
    }));
  }
  throw new Error('Could not extract families from ' + FAMILIES_FILE);
}

function loadLandingSlugs() {
  return fs.readdirSync(LANDING_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

function loadTagline(slug) {
  try {
    const raw = fs.readFileSync(path.join(LANDING_DIR, slug + '.json'), 'utf8');
    const data = JSON.parse(raw);
    const summary = data.summary || data.tagline || data.hint || data.overview;
    if (typeof summary !== 'string') return '';
    const firstSentence = summary.split(/(?<=[.!?])\s+/)[0];
    return firstSentence.length > 140 ? firstSentence.slice(0, 137) + '…' : firstSentence;
  } catch {
    return '';
  }
}

function main() {
  const families   = loadFamilies();
  const slugSet    = new Set(loadLandingSlugs());

  const matched = families
    .filter(f => slugSet.has(f.slug))
    .map(f => ({
      slug:         f.slug,
      label:        f.label,
      manufacturer: f.manufacturer,
      category:     CATEGORY_MAP[f.type] || 'other',
      tagline:      loadTagline(f.slug),
    }))
    .sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.label.localeCompare(b.label));

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(matched, null, 2) + '\n', 'utf8');
  console.log(`[build-aircraft-index] wrote ${matched.length} entries → ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
}

main();

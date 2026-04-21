#!/usr/bin/env node
/**
 * Regenerates raster icon assets in client/public/ from logo.svg.
 *
 * Output:
 *   favicon-16x16.png, favicon-32x32.png, favicon.ico (multi-size 16/32/48),
 *   apple-touch-icon.png (180), android-chrome-192x192.png,
 *   android-chrome-512x512.png, maskable-icon-512x512.png, og-image.png (1200x630).
 *
 * Run manually when the logo changes:
 *   node scripts/generate-icons.mjs
 *
 * NOT wired into postbuild — icons are static artifacts that only need
 * regeneration when the brand mark changes. Re-running produces byte-stable
 * output (modulo libvips/zlib encoder variations).
 *
 * Deps: sharp (PNG rasterization + compositing), png-to-ico (.ico bundling).
 * Both live in client/devDependencies — they are not shipped with the app.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const LOGO_SVG_PATH = join(PUBLIC_DIR, 'logo.svg');

// Brand palette — kept in sync with logo.svg gradient stops.
const BRAND = {
  gradientStart: '#3B8BFF',
  gradientEnd: '#0A42B5',
  ogBackground: '#0A1228',
};

// Plane geometry is duplicated from logo.svg so we can reuse it on the
// full-bleed gradient (maskable icon) without baking the circle badge into
// Android's adaptive mask. Keep in lockstep with the badge SVG if geometry
// ever changes.
const PLANE_PATHS = `
  <g transform="translate(256,256) rotate(35) scale(2.0) translate(-100,-99)" fill="white">
    <ellipse cx="100" cy="99" rx="9" ry="88"/>
    <path d="M91 76 C80 80, 42 94, 10 114 C7 118, 8 123, 12 124 C17 122, 42 106, 91 100 Z"/>
    <path d="M109 76 C120 80, 158 94, 190 114 C193 118, 192 123, 188 124 C183 122, 158 106, 109 100 Z"/>
    <path d="M91 160 C78 165, 60 175, 58 181 C57 184, 60 186, 63 185 C68 183, 80 177, 91 170 Z"/>
    <path d="M109 160 C122 165, 140 175, 142 181 C143 184, 140 186, 137 185 C132 183, 120 177, 109 170 Z"/>
  </g>
`;

const logoSvgBuffer = readFileSync(LOGO_SVG_PATH);

// ── Helpers ───────────────────────────────────────────────────────────────
const renderCircleBadgeToPng = (size) =>
  sharp(logoSvgBuffer, { density: Math.max(72, Math.round(size * 1.5)) })
    .resize(size, size, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toBuffer();

// Maskable icon: full-bleed gradient square with the plane scaled to ~60% of
// canvas, so Android's adaptive mask (crops outer ~20%) leaves the artwork
// intact. No circle stroke — it would get cropped inconsistently across
// skins. Plane is rendered inline at scale 1.2 (inside a 512 canvas this
// yields ~60% coverage vs. the badge's ~94%).
const buildMaskableSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="86" y1="21" x2="426" y2="491" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${BRAND.gradientStart}"/>
      <stop offset="100%" stop-color="${BRAND.gradientEnd}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256,256) rotate(35) scale(1.2) translate(-100,-99)" fill="white">
    <ellipse cx="100" cy="99" rx="9" ry="88"/>
    <path d="M91 76 C80 80, 42 94, 10 114 C7 118, 8 123, 12 124 C17 122, 42 106, 91 100 Z"/>
    <path d="M109 76 C120 80, 158 94, 190 114 C193 118, 192 123, 188 124 C183 122, 158 106, 109 100 Z"/>
    <path d="M91 160 C78 165, 60 175, 58 181 C57 184, 60 186, 63 185 C68 183, 80 177, 91 170 Z"/>
    <path d="M109 160 C122 165, 140 175, 142 181 C143 184, 140 186, 137 185 C132 183, 120 177, 109 170 Z"/>
  </g>
</svg>`;

// Apple touch icon: iOS adds its own rounded mask. Inset the badge ~8% so
// the stroke/gradient edge never hits the mask corner.
const buildAppleTouchSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
  <rect width="180" height="180" fill="${BRAND.gradientEnd}"/>
  <g transform="translate(14.4,14.4) scale(0.3)">
    <defs>
      <linearGradient id="bg" x1="86" y1="21" x2="426" y2="491" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="${BRAND.gradientStart}"/>
        <stop offset="100%" stop-color="${BRAND.gradientEnd}"/>
      </linearGradient>
    </defs>
    <circle cx="256" cy="256" r="240" fill="url(#bg)"/>
    <circle cx="256" cy="256" r="222" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="6"/>
    ${PLANE_PATHS}
  </g>
</svg>`;

// Open Graph card (1200×630). Logo left-center, wordmark + tagline right.
// Fonts are system-family — baked into the PNG so crawlers don't need to
// resolve webfonts.
const buildOgSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="86" y1="21" x2="426" y2="491" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${BRAND.gradientStart}"/>
      <stop offset="100%" stop-color="${BRAND.gradientEnd}"/>
    </linearGradient>
    <radialGradient id="glow" cx="280" cy="315" r="400" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0A42B5" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#0A1228" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${BRAND.ogBackground}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <!-- Logo badge at 320px centered vertically, left column -->
  <g transform="translate(120,155) scale(0.625)">
    <circle cx="256" cy="256" r="240" fill="url(#bg)"/>
    <circle cx="256" cy="256" r="222" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="6"/>
    ${PLANE_PATHS}
  </g>
  <!-- Wordmark -->
  <text x="500" y="310"
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        font-size="88" font-weight="800" fill="#ffffff" letter-spacing="-3">
    FlightFinder
  </text>
  <!-- Tagline -->
  <text x="504" y="370"
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        font-size="30" font-weight="500" fill="#94a3b8" letter-spacing="-0.5">
    Search flights by aircraft type
  </text>
</svg>`;

// ── Targets ───────────────────────────────────────────────────────────────
const writeBuffer = (name, buf) => {
  const path = join(PUBLIC_DIR, name);
  writeFileSync(path, buf);
  console.log(`[generate-icons] wrote ${name} (${(buf.length / 1024).toFixed(1)}KB)`);
};

const main = async () => {
  // Standard badge renders (scale logo.svg directly).
  const png16 = await renderCircleBadgeToPng(16);
  const png32 = await renderCircleBadgeToPng(32);
  const png48 = await renderCircleBadgeToPng(48);
  const png192 = await renderCircleBadgeToPng(192);
  const png512 = await renderCircleBadgeToPng(512);

  writeBuffer('favicon-16x16.png', png16);
  writeBuffer('favicon-32x32.png', png32);
  writeBuffer('android-chrome-192x192.png', png192);
  writeBuffer('android-chrome-512x512.png', png512);

  // Multi-size .ico bundle (16/32/48) — legacy /favicon.ico fallback.
  const icoBuffer = await pngToIco([png16, png32, png48]);
  writeBuffer('favicon.ico', icoBuffer);

  // Apple touch icon — inset inside iOS's mask.
  const appleSvg = Buffer.from(buildAppleTouchSvg());
  const applePng = await sharp(appleSvg, { density: 300 })
    .resize(180, 180)
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeBuffer('apple-touch-icon.png', applePng);

  // Maskable icon — full-bleed gradient, plane at 60%.
  const maskableSvg = Buffer.from(buildMaskableSvg());
  const maskablePng = await sharp(maskableSvg, { density: 300 })
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeBuffer('maskable-icon-512x512.png', maskablePng);

  // Open Graph card.
  const ogSvg = Buffer.from(buildOgSvg());
  const ogPng = await sharp(ogSvg, { density: 144 })
    .resize(1200, 630)
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeBuffer('og-image.png', ogPng);

  console.log('[generate-icons] done.');
};

main().catch((err) => {
  console.error('[generate-icons] failed:', err);
  process.exit(1);
});

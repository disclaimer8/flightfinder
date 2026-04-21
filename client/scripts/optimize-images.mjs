#!/usr/bin/env node
/**
 * Recursively compresses PNGs under client/public/ + client/dist/ via pngquant.
 * Runs in `postbuild` so both the source PNG (shipped via public/) and any
 * build-copied copy end up compressed. Skips files that pngquant says would
 * grow (--skip-if-larger).
 *
 * Requires pngquant on PATH. Install with `brew install pngquant` locally, or
 * `apt-get install -y pngquant` in CI/on the server. On deploy, the build step
 * runs on the VPS (Ubuntu) — ensure pngquant is installed there too.
 *
 * Why pngquant and not sharp: pngquant is a single-binary dependency with no
 * Node bindings, so it doesn't need to be rebuilt for each Node version. Sharp
 * would pull in ~30MB of native deps and is overkill for 2-3 PNGs.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const roots = [
  join(__dirname, '..', 'public'),
  join(__dirname, '..', 'dist'),
];

const walk = (dir) => {
  let out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(walk(p));
    else if (name.toLowerCase().endsWith('.png')) out.push(p);
  }
  return out;
};

let pngquantAvailable = true;
try {
  execFileSync('pngquant', ['--version'], { stdio: 'ignore' });
} catch {
  pngquantAvailable = false;
  console.warn('[optimize-images] pngquant not found on PATH — skipping.');
  process.exit(0);
}

let totalBefore = 0, totalAfter = 0, files = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    const before = statSync(file).size;
    try {
      execFileSync('pngquant', [
        '--quality=75-90',
        '--strip',
        '--skip-if-larger',
        '--force',
        '--output', file,
        file,
      ], { stdio: 'ignore' });
    } catch {
      // pngquant exits non-zero on --skip-if-larger; that's fine, file untouched
      continue;
    }
    const after = statSync(file).size;
    if (after < before) {
      totalBefore += before; totalAfter += after; files++;
      console.log(`[optimize-images] ${file.replace(join(__dirname, '..'), '.')}: ${(before/1024).toFixed(0)}KB → ${(after/1024).toFixed(0)}KB`);
    }
  }
}
if (files > 0) {
  const savedKB = ((totalBefore - totalAfter) / 1024).toFixed(0);
  const pct = (100 * (totalBefore - totalAfter) / totalBefore).toFixed(0);
  console.log(`[optimize-images] total: ${files} files, saved ${savedKB}KB (${pct}%)`);
}

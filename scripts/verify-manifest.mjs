#!/usr/bin/env node
// Recomputes SHA-256 and size for every file in vendor/MANIFEST.json and fails on any mismatch,
// missing file, or unlisted file under vendor/ or models/.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(ROOT, 'vendor/MANIFEST.json'), 'utf8'));
let bad = 0;
const listed = new Set();
for (const f of manifest.files) {
  listed.add(f.path);
  const p = join(ROOT, f.path);
  if (!existsSync(p)) { console.error('MISSING', f.path); bad++; continue; }
  const buf = await readFile(p);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== f.sha256 || buf.length !== f.size) { console.error('MISMATCH', f.path); bad++; }
}
async function walk(d) {
  if (!existsSync(d)) return [];
  const out = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}
for (const p of [...await walk(join(ROOT, 'vendor')), ...await walk(join(ROOT, 'models'))]) {
  const r = relative(ROOT, p).split(sep).join('/');
  if (r === 'vendor/MANIFEST.json') continue;
  if (!listed.has(r)) { console.error('UNLISTED', r); bad++; }
}
if (bad) { console.error(`${bad} problem(s) in vendored files`); process.exit(1); }
console.log(`OK: ${manifest.files.length} files match vendor/MANIFEST.json`);

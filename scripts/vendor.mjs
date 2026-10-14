#!/usr/bin/env node
// Procedure Scribe vendor step.
// 1. Copies every runtime library from node_modules into vendor/ at the exact versions in package.json.
// 2. With --models, downloads whisper tiny and base from onnx-community at the commit hash recorded in
//    models/REVISIONS.json (or resolves and records the current commit on first run).
// 3. Writes vendor/MANIFEST.json with path, size and SHA-256 for every vendored and model file.
//
// Usage: node scripts/vendor.mjs [--models] [--candidate]
//   --candidate also vendors Transformers.js 4.3.1 into spikes/gate2/v4/ for the Gate 2 comparison.

import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NM = join(ROOT, 'node_modules');
const args = new Set(process.argv.slice(2));
const MAX_FILE = 100 * 1024 * 1024; // GitHub per file limit

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const installed = (name) => JSON.parse(readFileSync(join(NM, name, 'package.json'), 'utf8')).version;

// Refuse to vendor if node_modules drifted from package.json.
for (const [name, want] of Object.entries(pkg.dependencies)) {
  const have = installed(name);
  if (have !== want) throw new Error(`${name}: package.json pins ${want} but node_modules has ${have}. Run npm ci.`);
}

const COPIES = [
  ['@huggingface/transformers/dist/transformers.min.js', 'vendor/transformers/transformers.min.js'],
  // Transformers.js 3.8.1 bundles onnxruntime-web; these are the wasm runtime files it would otherwise fetch from jsDelivr.
  ['@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs', 'vendor/ort/ort-wasm-simd-threaded.jsep.mjs'],
  ['@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm', 'vendor/ort/ort-wasm-simd-threaded.jsep.wasm'],
  ['@ffmpeg/ffmpeg/dist/umd/ffmpeg.js', 'vendor/ffmpeg/ffmpeg.js'],
  ['@ffmpeg/ffmpeg/dist/umd/814.ffmpeg.js', 'vendor/ffmpeg/814.ffmpeg.js'],
  ['@ffmpeg/core/dist/umd/ffmpeg-core.js', 'vendor/ffmpeg/ffmpeg-core.js'],
  ['@ffmpeg/core/dist/umd/ffmpeg-core.wasm', 'vendor/ffmpeg/ffmpeg-core.wasm'],
  ['@ffmpeg/util/dist/umd/index.js', 'vendor/ffmpeg/util.js'],
  ['docx/dist/index.iife.js', 'vendor/docx/docx.iife.js'],
];

for (const [src, dst] of COPIES) {
  const to = join(ROOT, dst);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(join(NM, src), to);
  console.log('copied', dst);
}

const versions = Object.fromEntries(Object.keys(pkg.dependencies).map((n) => [n, installed(n)]));
await writeFile(join(ROOT, 'vendor/versions.json'), JSON.stringify(versions, null, 2) + '\n');

// Optional: Transformers.js 4.3.1 candidate for Gate 2 only. Never loaded by the app.
if (args.has('--candidate')) {
  const cand = join(ROOT, 'spikes/gate2/v4');
  await mkdir(cand, { recursive: true });
  const tmp = join(ROOT, '.candidate');
  const { execSync } = await import('node:child_process');
  await mkdir(tmp, { recursive: true });
  execSync(`npm pack @huggingface/transformers@4.3.1 --pack-destination ${tmp}`, { stdio: 'inherit', cwd: ROOT });
  execSync(`mkdir -p ${tmp}/x && tar -xzf ${tmp}/*.tgz -C ${tmp}/x`, { shell: true });
  const dist = join(tmp, 'x/package/dist');
  for (const f of await readdir(dist)) {
    if (/^transformers\.min\.js$|^ort-wasm.*\.(mjs|wasm)$/.test(f)) await copyFile(join(dist, f), join(cand, f));
  }
  await rm(tmp, { recursive: true, force: true });
  console.log('vendored Transformers.js 4.3.1 candidate into spikes/gate2/v4');
}

// ---- Models ---------------------------------------------------------------
const MODEL_IDS = ['onnx-community/whisper-tiny', 'onnx-community/whisper-base'];
const META_FILES = [
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'processor_config.json',
  'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json',
  'normalizer.json', 'vocab.json', 'merges.txt',
];
// Only the ONNX variants the app uses: fp32 encoder + q4 merged decoder (WebGPU), q8 encoder + decoder (WASM).
const ONNX_FILES = [
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged_q4.onnx',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

if (args.has('--models')) {
  const revPath = join(ROOT, 'models/REVISIONS.json');
  const revisions = existsSync(revPath) ? JSON.parse(await readFile(revPath, 'utf8')) : {};
  for (const id of MODEL_IDS) {
    let sha = revisions[id]?.sha;
    if (!sha) {
      const info = await (await fetch(`https://huggingface.co/api/models/${id}/revision/main`)).json();
      sha = info.sha;
      revisions[id] = { sha, recorded: new Date().toISOString().slice(0, 10) };
      console.log(`recorded ${id} at ${sha}`);
    }
    const tree = await (await fetch(`https://huggingface.co/api/models/${id}/tree/${sha}/onnx`)).json();
    const onnxNames = new Set(tree.map((t) => t.path));
    const wanted = [...META_FILES];
    for (const f of ONNX_FILES) {
      if (!onnxNames.has(f)) throw new Error(`${id}@${sha} has no ${f}`);
      wanted.push(f);
      if (onnxNames.has(f + '_data')) wanted.push(f + '_data');
    }
    for (const f of wanted) {
      const url = `https://huggingface.co/${id}/resolve/${sha}/${f}`;
      const res = await fetch(url);
      if (res.status === 404 && META_FILES.includes(f)) continue; // optional metadata file
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length >= MAX_FILE) throw new Error(`${id}/${f} is ${buf.length} bytes, over the 100 MB per file limit`);
      const to = join(ROOT, 'models', id, f);
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, buf);
      console.log(`downloaded ${id}/${f} (${(buf.length / 1e6).toFixed(1)} MB)`);
    }
  }
  await writeFile(revPath, JSON.stringify(revisions, null, 2) + '\n');
}

// ---- Manifest -------------------------------------------------------------
async function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}
const files = [...await walk(join(ROOT, 'vendor')), ...await walk(join(ROOT, 'models'))]
  .filter((p) => !p.endsWith('MANIFEST.json'))
  .sort();
const manifest = { generated: new Date().toISOString(), versions, files: [] };
let total = 0;
for (const p of files) {
  const buf = await readFile(p);
  if (buf.length >= MAX_FILE) throw new Error(`${p} exceeds 100 MB`);
  total += buf.length;
  manifest.files.push({
    path: relative(ROOT, p).split(sep).join('/'),
    size: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  });
}
await writeFile(join(ROOT, 'vendor/MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`MANIFEST.json: ${manifest.files.length} files, ${(total / 1e6).toFixed(1)} MB`);

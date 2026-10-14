#!/usr/bin/env node
// Drives the Gate 1 and Gate 2 spike pages on the live Pages URL with headless Chromium
// and writes the evidence to spikes/results/. Usage: node scripts/run-gates.mjs <baseURL> <bigMediaPath>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = (process.argv[2] || 'https://augustineiacopelli.github.io/appaday-160-procedure-scribe/').replace(/\/?$/, '/');
const big = process.argv[3];
// The 4.3.1 candidate is never committed, so its run uses a local server of the same checkout.
const local = (process.argv[4] || base).replace(/\/?$/, '/');
await mkdir('spikes/results', { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const summary = {};

async function page() {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const requests = [];
  p.on('request', (r) => requests.push(r.url()));
  ctx.on('request', (r) => requests.push(r.url()));
  return { p, ctx, requests };
}
const origins = (urls) => [...new Set(urls.filter((u) => /^https?:/.test(u)).map((u) => new URL(u).origin))];

// Gate 1
{
  const { p, ctx, requests } = await page();
  await p.goto(base + 'spikes/gate1/');
  if (big) await p.setInputFiles('#file', big); else await p.click('#synth');
  await p.waitForFunction(() => window.__gate1, null, { timeout: 15 * 60 * 1000 });
  const r = await p.evaluate(() => window.__gate1);
  r.networkOrigins = origins(requests);
  summary.gate1 = r;
  await ctx.close();
}

// Gate 2: 3.8.1 and 4.3.1 on the 3 minute reference, plus tiny on WASM.
const runs = [
  { lib: 'v3', model: 'whisper-base', device: 'wasm', clip: 'ref-3min.mp3' },
  { lib: 'v4', model: 'whisper-base', device: 'wasm', clip: 'ref-3min.mp3' },
  { lib: 'v3', model: 'whisper-tiny', device: 'wasm', clip: 'clip-45s.wav' },
];
summary.gate2 = [];
for (const cfg of runs) {
  const { p, ctx, requests } = await page();
  await p.goto((cfg.lib === 'v4' ? local : base) + 'spikes/gate2/');
  const r = await p.evaluate((c) => window.runGate2(c), cfg).catch((e) => ({ ...cfg, error: String(e) }));
  r.networkOrigins = origins(requests);
  summary.gate2.push(r);
  console.log(cfg, 'chunks', r.chunkCount, 'error', r.error || 'none');
  await ctx.close();
}
await browser.close();

const [a, b] = summary.gate2;
const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
summary.verdict = {
  gate1Pass: !!summary.gate1.pass && summary.gate1.networkOrigins.every((o) => base.startsWith(o)),
  v3Chunks: a.chunkCount, v4Chunks: b.chunkCount,
  v4TextMatchesV3: norm(a.text) === norm(b.text),
  v4UpgradeAllowed: b.chunkCount > 1 && b.chunkCount === a.chunkCount && norm(a.text) === norm(b.text),
  allGate2SameOrigin: summary.gate2.every((r) => r.networkOrigins.every((o) => base.startsWith(o) || local.startsWith(o))),
};
await writeFile('spikes/results/ci-chromium.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary.verdict, null, 2));

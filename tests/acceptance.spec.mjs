// Acceptance checks that can be automated. Run by hand: npx playwright test acceptance
// LONG31 may point at any audio file over 30 minutes (not committed; any long recording works).
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const fx = (f) => new URL('./fixtures/' + f, import.meta.url).pathname;
const XSS = '<img src=x onerror=alert(1)>';
const MD = '# Intake Call ' + XSS + '\n\n## Purpose\n\nHandle **every** call the same way. ' + XSS + '\n\n## Procedure\n\n1. Greet the caller.\n2. Confirm the **student ID**.\n   1. Ask twice if unclear.\n3. Log the call.\n\n- Note one\n- Note two\n';

function track(page, baseURL) {
  const allowed = new Set([new URL(baseURL).origin, 'https://augustineiacopelli.github.io']);
  const bad = []; const posts = [];
  page.context().on('request', (r) => {
    const u = new URL(r.url());
    if (/^https?:$/.test(u.protocol) && !allowed.has(u.origin)) bad.push(r.url());
    if (r.method() !== 'GET') posts.push(r.method() + ' ' + r.url());
  });
  page.on('dialog', (d) => { bad.push('DIALOG ' + d.message()); d.dismiss(); });
  return { bad, posts };
}
async function runTranscribe(page, file, model = 'tiny') {
  await page.goto('./');
  await page.click('#gearBtn'); await page.check('#forceWasm'); await page.click('#settingsDlg [data-close]');
  await page.setInputFiles('#picker', file);
  await page.click('#intakeGo');
  await expect(page.locator('#c2')).toHaveText(/Ready|Fallback/, { timeout: 120000 });
  await page.click(`#modelSeg button[data-model="${model}"]`);
  await page.click('#transcribeGo');
  await expect(page.locator('#c3')).toHaveText('Done', { timeout: 30 * 60 * 1000 });
  return (await page.locator('#transcript').textContent()).toLowerCase();
}

for (const ext of ['mp4', 'mov', 'm4a', 'mp3', 'wav']) {
  test(`${ext} transcribes, chunking reaches the final 15 seconds`, async ({ page, baseURL }) => {
    const net = track(page, baseURL);
    const text = await runTranscribe(page, fx('clip-45s.' + ext), 'base');
    // The final sentence starts at about 32 s, past the first 30 s window.
    for (const w of ['final step', 'recording']) expect(text).toContain(w);
    console.log(ext, 'tail:', text.slice(-80));
    expect(net.bad).toEqual([]);
    expect(net.posts).toEqual([]);
  });
}

test('over 30 minutes needs a second tap', async ({ page }) => {
  const f = process.env.LONG31;
  test.skip(!f || !existsSync(f), 'set LONG31 to a recording over 30 minutes');
  await page.goto('./');
  await page.setInputFiles('#picker', f);
  await expect(page.locator('#longWarn')).toBeVisible();
  await page.click('#intakeGo');
  await expect(page.locator('#s2')).toHaveClass(/locked/);
  await page.click('#intakeGo');
  await expect(page.locator('#s2')).not.toHaveClass(/locked/);
});

test('25 minute recording has no gap or duplicate at 10 minute boundaries', async ({ page, baseURL }) => {
  test.setTimeout(40 * 60 * 1000);
  const net = track(page, baseURL);
  const text = await runTranscribe(page, fx('long-25min.mp3'), 'base');
  await page.check('#tsToggle');
  const lines = (await page.locator('#transcript').textContent()).split('\n');
  const markers = [];
  for (const m of text.matchAll(/marker (\d+)/g)) markers.push(+m[1]);
  // Whisper occasionally mishears a number, so check that markers increase and none repeat.
  const dupes = markers.filter((n, i) => markers.indexOf(n) !== i);
  let backwards = 0; for (let i = 1; i < markers.length; i++) if (markers[i] < markers[i - 1]) backwards++;
  const around = (sec) => lines.filter((l) => { const m = /^\[(\d+):(\d+)\]/.exec(l); if (!m) return false; const t = +m[1] * 60 + +m[2]; return t > sec - 25 && t < sec + 25; });
  console.log('markers', markers.length, 'first', markers[0], 'last', markers[markers.length - 1], 'dupes', dupes, 'backwards', backwards);
  console.log('around 600 s:\n' + around(600).join('\n'));
  console.log('around 1200 s:\n' + around(1200).join('\n'));
  expect(dupes).toEqual([]);
  expect(backwards).toBe(0);
  expect(markers.length).toBeGreaterThan(300);
  expect(net.bad).toEqual([]);
});

test('finish: literal HTML, word count, downloads, clear, storage, no query strings', async ({ page, baseURL }) => {
  const net = track(page, baseURL);
  await runTranscribe(page, fx('smoke-10s.wav'));
  await expect(page.locator('#openClaude')).toHaveAttribute('href', 'https://claude.ai/new');
  await page.click('#promptGo');
  await page.fill('#output', MD);
  const words = MD.split(/\s+/).filter(Boolean).length;
  await expect(page.locator('#wordCount')).toHaveText(words + ' words');
  await page.click('#previewBtn');
  await expect(page.locator('#preview img')).toHaveCount(0);
  await expect(page.locator('#preview h1')).toContainText(XSS);
  await expect(page.locator('#preview > ol > li')).toHaveCount(3);
  await expect(page.locator('#preview > ol ol > li')).toHaveCount(1);
  await expect(page.locator('#preview strong')).toHaveCount(2);
  const saved = {};
  for (const [btn, ext] of [['#dlDocx', 'docx'], ['#dlMd', 'md'], ['#dlPlain', 'txt']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(btn)]);
    const p = '/tmp/claude-0/accept.' + ext; await dl.saveAs(p); saved[ext] = p;
  }
  expect(readFileSync(saved.md, 'utf8')).toBe(MD);
  const plain = readFileSync(saved.txt, 'utf8');
  expect(plain).toContain(XSS); expect(plain).not.toContain('**'); expect(plain).not.toMatch(/^#/m);
  // Clear wipes everything and nothing user generated is in storage.
  await page.click('#clearBtn');
  await expect(page.locator('#flash')).toContainText('Cleared');
  expect(await page.locator('#output').inputValue()).toBe('');
  expect(await page.locator('#transcript').textContent()).toBe('');
  expect(await page.locator('#picker').evaluate((e) => e.files.length)).toBe(0);
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie,
    idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
    caches: await caches.keys(),
  }));
  console.log('storage after Clear', JSON.stringify(storage));
  expect(storage.session).toEqual([]); expect(storage.cookie).toBe('');
  expect(storage.local.filter((k) => !/^appaday-/.test(k))).toEqual([]);
  expect(net.bad).toEqual([]);
  await page.reload();
  expect(await page.locator('#output').inputValue()).toBe('');
  await expect(page.locator('#s3')).toHaveClass(/locked/);
});

test('375 px: no horizontal scroll, every control at least 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('./');
  await page.setInputFiles('#picker', fx('smoke-10s.wav'));
  await page.click('#intakeGo');
  await expect(page.locator('#c2')).toHaveText(/Ready/, { timeout: 120000 });
  for (const n of [4, 5]) await page.evaluate((i) => document.getElementById('s' + i).classList.remove('locked'), n);
  const r = await page.evaluate(() => {
    const over = document.documentElement.scrollWidth - window.innerWidth;
    const small = [...document.querySelectorAll('button, a, input, select, textarea, [role=button]')]
      .filter((e) => e.offsetParent !== null && e.id !== 'picker' && !e.closest('label.check'))
      .map((e) => ({ id: e.id || e.textContent.trim().slice(0, 20), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
      .filter((b) => b.h < 44 || b.w < 44);
    return { over, small };
  });
  console.log(JSON.stringify(r));
  expect(r.over).toBeLessThanOrEqual(0);
  expect(r.small).toEqual([]);
});

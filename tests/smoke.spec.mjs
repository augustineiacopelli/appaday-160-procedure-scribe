// Weekly smoke test: tiny on WASM transcribes the 10 s fixture, the SOP prompt builds,
// and all three downloads fire. Runs against the live Pages URL unless BASE_URL is set.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const expected = JSON.parse(readFileSync(new URL('./fixtures/smoke-expected.json', import.meta.url)));
const SAMPLE_MD = '# Opening the Office\n\n## Purpose\n\nOpen the **front office** each morning.\n\n## Procedure\n\n1. Unlock the door.\n2. Turn on the lights.\n   1. Main panel first.\n3. Check the printer paper.\n\n- Note one\n- Note two\n';

test('transcribe, prompt, and export', async ({ page, baseURL }) => {
  // The app and the AppADay portal (save.js, config.json, icons) share one origin on GitHub Pages.
  const allowed = new Set([new URL(baseURL).origin, 'https://augustineiacopelli.github.io']);
  const external = [];
  page.context().on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && !allowed.has(u.origin)) external.push(r.url()); });
  await page.goto('./');
  await page.click('#gearBtn');
  await page.check('#forceWasm');
  await page.click('#settingsDlg [data-close]');
  await page.setInputFiles('#picker', new URL('./fixtures/smoke-10s.wav', import.meta.url).pathname);
  await expect(page.locator('#fDur')).toHaveText(/0:1\d/);
  await page.click('#intakeGo');
  await expect(page.locator('#c2')).toHaveText(/Ready|Fallback/, { timeout: 120000 });
  await page.click('#modelSeg button[data-model="tiny"]');
  await expect(page.locator('#deviceLine')).toContainText('WASM');
  await page.click('#transcribeGo');
  await expect(page.locator('#c3')).toHaveText('Done', { timeout: 8 * 60 * 1000 });
  const text = (await page.locator('#transcript').textContent()).toLowerCase();
  for (const w of expected.mustContain) expect(text, `transcript should contain "${w}"`).toContain(w);

  await page.click('#tplSeg button[data-tpl="sop"]');
  await page.click('#copyPrompt');
  await expect(page.locator('#leaveNote')).toBeVisible();
  await page.click('#copyPrompt');
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('standard operating procedure');
  expect(prompt).toMatch(/<transcript>\n[\s\S]*quick[\s\S]*\n<\/transcript>$/i);

  await page.click('#promptGo');
  await page.fill('#output', SAMPLE_MD);
  await expect(page.locator('#wordCount')).toHaveText(`${SAMPLE_MD.split(/\s+/).filter(Boolean).length} words`);
  for (const [btn, ext] of [['#dlDocx', 'docx'], ['#dlMd', 'md'], ['#dlPlain', 'txt']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(btn)]);
    expect(dl.suggestedFilename()).toBe(`SOP_smoke-10s.${ext}`);
  }
  expect(external, 'no request may leave the site').toEqual([]);
});

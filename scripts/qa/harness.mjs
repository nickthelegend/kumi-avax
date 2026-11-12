/**
 * Shared Playwright harness: one headless Chrome at a time (withChromeLock, shared with other sessions),
 * and the QA signer. The three member keys are read from the repo's gitignored .env inside this process and
 * injected into the page as window.__KUMI_QA__; they are never printed, logged or written anywhere.
 * Only QA builds (VITE_QA=1, web/dist-qa) read that object.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { withChromeLock } from '/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
function env() {
  const out = {};
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export async function withBrowser(fn) {
  return withChromeLock(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try { return await fn(browser); } finally { await browser.close(); }
  });
}

export async function qaPage(browser, { width = 1440, height = 900, as = 'mika' } = {}) {
  const e = env();
  const keys = { mika: e.KUMI_MIKA_KEY, bo: e.KUMI_BO_KEY, ren: e.KUMI_REN_KEY };
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([k, who]) => {
    window.__KUMI_QA__ = { keys: k };
    try { sessionStorage.setItem('kumi:qa', who); } catch {}
  }, [keys, as]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', x => errors.push(String(x)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const txs = [];
  await page.exposeFunction('__kumiRecordTx', d => txs.push(d));
  await ctx.addInitScript(() => addEventListener('kumi:tx', ev => window.__kumiRecordTx?.(ev.detail)));
  return { page, ctx, errors, txs };
}
